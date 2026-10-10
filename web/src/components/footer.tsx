import React from 'react';

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white mt-auto py-8 text-slate-500 text-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-2">
          <span className="font-bold text-orange-600">FlashCart</span>
          <span>— High-Concurrency Multi-Vendor Marketplace</span>
        </div>
        <div className="text-xs text-slate-400">
          Strict PostgreSQL Invariants • Zero Overselling • Decoupled Sandbox Payments
        </div>
      </div>
    </footer>
  );
}
