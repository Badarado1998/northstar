//! Account sign-in, subscription status, and one platform-model completion.
//! Refresh tokens stay in the OS secure store. The webview never receives them.
//! Installed coding CLIs are not sent through this client.

use crate::secret_store;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

const SERVICE: &str = "ai.pandacode.desktop";
const ACCOUNT: &str = "saas.session";
const BRAND_JSON: &str = include_str!("../../brand.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Brand {
    api_base_url: String,
    product_name: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct Stored {
    refresh: String,
    device_id: String,
}

struct Live {
    refresh: String,
    access: String,
    access_until: Instant,
    device_id: String,
}

struct Pending {
    device_code: String,
    user_code: String,
    verification_uri: String,
}

fn sessions() -> &'static tokio::sync::Mutex<Option<Live>> {
    static SESSIONS: OnceLock<tokio::sync::Mutex<Option<Live>>> = OnceLock::new();
    SESSIONS.get_or_init(|| tokio::sync::Mutex::new(None))
}

fn pending() -> &'static tokio::sync::Mutex<Option<Pending>> {
    static PENDING: OnceLock<tokio::sync::Mutex<Option<Pending>>> = OnceLock::new();
    PENDING.get_or_init(|| tokio::sync::Mutex::new(None))
}

fn brand() -> Result<Brand, String> {
    serde_json::from_str(BRAND_JSON).map_err(|_| "The brand file is invalid.".into())
}

fn api_base() -> Result<(String, bool), String> {
    let brand = brand()?;
    let url = tauri::Url::parse(brand.api_base_url.trim()).map_err(|_| "The account address is invalid.".to_string())?;
    let host = url.host_str().unwrap_or("");
    let local = host == "127.0.0.1" || host == "localhost";
    if url.scheme() != "https" && !(local && url.scheme() == "http") {
        return Err("The account service must use HTTPS, or HTTP on this computer.".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("The account address cannot contain credentials.".into());
    }
    let mut base = url;
    base.set_path("");
    base.set_query(None);
    base.set_fragment(None);
    Ok((base.as_str().trim_end_matches('/').to_string(), local))
}

fn client(local_http: bool) -> Result<reqwest::Client, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .https_only(!local_http)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .user_agent(concat!("PandaCode/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "Could not prepare the account connection.".into())
}

async fn request(method: reqwest::Method, path: &str, token: Option<&str>, body: Option<Value>) -> Result<Value, String> {
    let (base, local) = api_base()?;
    let url = format!("{base}/api/{path}");
    let mut builder = client(local)?.request(method, &url);
    if let Some(token) = token {
        builder = builder.bearer_auth(token);
    }
    if let Some(body) = body {
        builder = builder.json(&body);
    }
    let response = builder.send().await.map_err(|_| "Could not reach the account service.".to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|_| "The account service sent an unreadable response.".to_string())?;
    let parsed: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if !status.is_success() {
        let message = parsed.get("error").and_then(Value::as_str).unwrap_or("The account service refused the request.");
        return Err(message.to_string());
    }
    Ok(parsed)
}

fn load_stored() -> Option<Stored> {
    let raw = secret_store::get(SERVICE, ACCOUNT)?;
    serde_json::from_str(&raw).ok()
}

fn save_stored(stored: &Stored) -> Result<(), String> {
    let raw = serde_json::to_string(stored).map_err(|_| "Could not store the session.".to_string())?;
    secret_store::set(SERVICE, ACCOUNT, &raw)
}

async fn access_token() -> Result<(String, String), String> {
    let mut guard = sessions().lock().await;
    if let Some(live) = guard.as_ref() {
        if live.access_until > Instant::now() + Duration::from_secs(30) {
            return Ok((live.access.clone(), live.device_id.clone()));
        }
    }
    let stored = guard.as_ref().map(|live| Stored { refresh: live.refresh.clone(), device_id: live.device_id.clone() }).or_else(load_stored);
    let Some(stored) = stored else { return Err("Sign in to your account.".into()) };
    let refreshed = request(reqwest::Method::POST, "auth/desktop/refresh", None, Some(json!({ "refreshToken": stored.refresh }))).await?;
    let refresh = refreshed.get("refreshToken").and_then(Value::as_str).unwrap_or("").to_string();
    let access = refreshed.get("accessToken").and_then(Value::as_str).unwrap_or("").to_string();
    let expires = refreshed.get("expiresIn").and_then(Value::as_u64).unwrap_or(60);
    if refresh.is_empty() || access.is_empty() {
        secret_store::remove(SERVICE, ACCOUNT);
        *guard = None;
        return Err("Sign in again.".into());
    }
    let next = Stored { refresh: refresh.clone(), device_id: stored.device_id.clone() };
    if save_stored(&next).is_err() {
        secret_store::remove(SERVICE, ACCOUNT);
        *guard = None;
        return Err("The new session could not be saved. Sign in again.".into());
    }
    *guard = Some(Live { refresh, access: access.clone(), access_until: Instant::now() + Duration::from_secs(expires), device_id: stored.device_id.clone() });
    Ok((access, stored.device_id))
}

fn string_at(value: &Value, pointer: &str) -> String {
    value.pointer(pointer).and_then(Value::as_str).unwrap_or("").to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountView {
    signed_in: bool,
    product_name: String,
    email: String,
    plan_name: String,
    plan_id: String,
    plan_status: String,
    period_end: String,
    allowance_label: String,
    included_label: String,
    topup_label: String,
    reserved_label: String,
    low_credit: bool,
    devices_active: i64,
    devices_allowance: i64,
    allow_topups: bool,
    note: String,
}

fn signed_out(note: &str) -> AccountView {
    let product_name = brand().map(|brand| brand.product_name).unwrap_or_else(|_| "App".into());
    AccountView {
        signed_in: false, product_name, email: String::new(), plan_name: String::new(), plan_id: String::new(), plan_status: String::new(),
        period_end: String::new(), allowance_label: String::new(), included_label: String::new(), topup_label: String::new(),
        reserved_label: String::new(), low_credit: false, devices_active: 0, devices_allowance: 0, allow_topups: false, note: note.into(),
    }
}

fn view_from(value: &Value) -> AccountView {
    let product_name = brand().map(|brand| brand.product_name).unwrap_or_else(|_| "App".into());
    AccountView {
        signed_in: true,
        product_name,
        email: string_at(value, "/email"),
        plan_name: string_at(value, "/plan/name"),
        plan_id: string_at(value, "/plan/id"),
        plan_status: string_at(value, "/plan/status"),
        period_end: string_at(value, "/plan/periodEnd"),
        allowance_label: string_at(value, "/plan/allowanceLabel"),
        included_label: string_at(value, "/credits/includedLabel"),
        topup_label: string_at(value, "/credits/topupLabel"),
        reserved_label: string_at(value, "/credits/reservedLabel"),
        low_credit: value.pointer("/lowCredit").and_then(Value::as_bool).unwrap_or(false),
        devices_active: value.pointer("/devices/active").and_then(Value::as_i64).unwrap_or(0),
        devices_allowance: value.pointer("/devices/allowance").and_then(Value::as_i64).unwrap_or(0),
        allow_topups: value.pointer("/plan/allowTopups").and_then(Value::as_bool).unwrap_or(false),
        note: "Installed coding agents keep their own sign-in and are not billed to these credits. A platform completion below is one model call, not a project agent.".into(),
    }
}

#[tauri::command]
pub async fn saas_status() -> Result<AccountView, String> {
    if load_stored().is_none() && sessions().lock().await.is_none() {
        return Ok(signed_out("Sign in to see your plan and platform-model credits."));
    }
    let (access, _) = access_token().await?;
    let account = request(reqwest::Method::GET, "account", Some(&access), None).await?;
    Ok(view_from(&account))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignInStart { user_code: String, verification_uri: String }

#[tauri::command]
pub async fn saas_sign_in_start() -> Result<SignInStart, String> {
    let started = request(reqwest::Method::POST, "auth/device/start", None, Some(json!({
        "deviceName": "This computer",
        "platform": std::env::consts::OS,
        "appVersion": env!("CARGO_PKG_VERSION"),
    }))).await?;
    let device_code = string_at(&started, "/deviceCode");
    let user_code = string_at(&started, "/userCode");
    let verification_uri = string_at(&started, "/verificationUri");
    if device_code.is_empty() || user_code.is_empty() || verification_uri.is_empty() {
        return Err("The account service did not start sign-in.".into());
    }
    *pending().lock().await = Some(Pending { device_code, user_code: user_code.clone(), verification_uri: verification_uri.clone() });
    Ok(SignInStart { user_code, verification_uri })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignInPoll { status: String, account: Option<AccountView> }

#[tauri::command]
pub async fn saas_sign_in_poll() -> Result<SignInPoll, String> {
    let pending = pending().lock().await;
    let Some(current) = pending.as_ref() else { return Err("Start sign-in first.".into()) };
    let device_code = current.device_code.clone();
    drop(pending);
    let polled = request(reqwest::Method::POST, "auth/device/token", None, Some(json!({ "deviceCode": device_code }))).await?;
    let status = string_at(&polled, "/status");
    if status == "pending" { return Ok(SignInPoll { status, account: None }); }
    if status != "approved" { return Err("Sign-in was not approved.".into()); }
    let refresh = string_at(&polled, "/refreshToken");
    let access = string_at(&polled, "/accessToken");
    let device_id = string_at(&polled, "/deviceId");
    let expires = polled.get("expiresIn").and_then(Value::as_u64).unwrap_or(60);
    if refresh.is_empty() || access.is_empty() || device_id.is_empty() {
        return Err("The account service did not return a session.".into());
    }
    save_stored(&Stored { refresh: refresh.clone(), device_id: device_id.clone() })?;
    *sessions().lock().await = Some(Live { refresh, access: access.clone(), access_until: Instant::now() + Duration::from_secs(expires), device_id });
    *pending().lock().await = None;
    let account = request(reqwest::Method::GET, "account", Some(&access), None).await?;
    Ok(SignInPoll { status: "approved".into(), account: Some(view_from(&account)) })
}

#[tauri::command]
pub async fn saas_sign_out() -> Result<(), String> {
    if let Ok((access, device_id)) = access_token().await {
        if !device_id.is_empty() {
            let _ = request(reqwest::Method::POST, "account/devices/revoke", Some(&access), Some(json!({ "deviceId": device_id }))).await;
        }
    }
    secret_store::remove(SERVICE, ACCOUNT);
    *sessions().lock().await = None;
    *pending().lock().await = None;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckoutInput { purpose: String, plan_id: Option<String>, package_id: Option<String> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Checkout { authorization_url: String }

#[tauri::command]
pub async fn saas_checkout(input: CheckoutInput) -> Result<Checkout, String> {
    let (access, _) = access_token().await?;
    let result = request(reqwest::Method::POST, "billing/checkout", Some(&access), Some(json!({
        "purpose": input.purpose, "planId": input.plan_id, "packageId": input.package_id,
    }))).await?;
    let authorization_url = string_at(&result, "/authorizationUrl");
    if authorization_url.is_empty() { return Err("Checkout did not return a payment page.".into()); }
    Ok(Checkout { authorization_url })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Catalog { plans: Value, packages: Value }

#[tauri::command]
pub async fn saas_catalog() -> Result<Catalog, String> {
    let result = request(reqwest::Method::GET, "billing/plans", None, None).await?;
    Ok(Catalog { plans: result.get("plans").cloned().unwrap_or(Value::Array(vec![])), packages: result.get("packages").cloned().unwrap_or(Value::Array(vec![])) })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompleteInput { model_id: String, prompt: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Completion { text: String, billed_micros: String, already_completed: bool }

#[tauri::command]
pub async fn saas_complete(input: CompleteInput) -> Result<Completion, String> {
    let prompt = input.prompt.trim();
    if prompt.is_empty() || prompt.len() > 8000 { return Err("Write a prompt under 8,000 characters.".into()); }
    let (access, _) = access_token().await?;
    let result = request(reqwest::Method::POST, "v1/ai/chat", Some(&access), Some(json!({
        "modelId": input.model_id,
        "messages": [{ "role": "user", "content": prompt }],
        "maxOutputTokens": 256,
        "idempotencyKey": uuid::Uuid::new_v4().to_string(),
    }))).await?;
    Ok(Completion {
        text: string_at(&result, "/text"),
        billed_micros: string_at(&result, "/billedMicros"),
        already_completed: result.get("alreadyCompleted").and_then(Value::as_bool).unwrap_or(false),
    })
}
