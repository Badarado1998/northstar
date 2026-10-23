'use client';

import { useEffect } from 'react';

const BODY_CLASSES = ['layout-fixed', 'sidebar-expand-lg', 'bg-body-tertiary'] as const;

export function DashboardScripts() {
  useEffect(() => {
    for (const name of BODY_CLASSES) document.body.classList.add(name);
    void import('bootstrap/dist/js/bootstrap.bundle.min.js');
    void import('admin-lte/dist/js/adminlte.min.js');
    return () => { for (const name of BODY_CLASSES) document.body.classList.remove(name); };
  }, []);
  return null;
}
