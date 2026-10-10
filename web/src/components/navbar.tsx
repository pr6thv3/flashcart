'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { ShoppingCart, Zap, User, Store, Package, LogOut, LogIn } from 'lucide-react';

export function Navbar() {
  const { user, logout, isVendor } = useAuth();
  const { itemCount } = useCart();

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center space-x-6">
          <Link href="/" className="flex items-center space-x-2 font-black text-xl text-orange-600 tracking-tight">
            <Zap className="w-6 h-6 fill-orange-500 text-orange-600 animate-pulse" />
            <span>FlashCart</span>
          </Link>
          <nav className="hidden md:flex items-center space-x-4 text-sm font-medium text-slate-600">
            <Link href="/" className="hover:text-orange-600 transition-colors">
              Marketplace
            </Link>
            <Link href="/orders" className="hover:text-orange-600 transition-colors flex items-center space-x-1">
              <Package className="w-4 h-4" />
              <span>My Orders</span>
            </Link>
            {isVendor && (
              <Link
                href="/vendor"
                className="bg-amber-50 text-amber-700 hover:bg-amber-100 px-2.5 py-1 rounded-md transition-colors flex items-center space-x-1 font-semibold"
              >
                <Store className="w-4 h-4" />
                <span>Vendor Portal</span>
              </Link>
            )}
          </nav>
        </div>

        {/* Right Nav */}
        <div className="flex items-center space-x-4">
          <Link
            href="/cart"
            className="relative p-2 text-slate-700 hover:text-orange-600 transition-colors flex items-center"
            title="Cart"
          >
            <ShoppingCart className="w-6 h-6" />
            {itemCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-orange-600 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shadow">
                {itemCount}
              </span>
            )}
          </Link>

          {user ? (
            <div className="flex items-center space-x-3 text-sm">
              <div className="hidden sm:flex flex-col text-right">
                <span className="font-semibold text-slate-900 leading-tight">{user.full_name || user.email}</span>
                <span className="text-xs text-slate-500 capitalize">{user.roles[0] || 'Customer'}</span>
              </div>
              <button
                onClick={() => logout()}
                className="p-2 text-slate-500 hover:text-red-600 transition-colors"
                title="Log out"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              <Link
                href="/login"
                className="text-sm font-semibold text-slate-700 hover:text-orange-600 px-3 py-1.5 rounded-md transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/register"
                className="text-sm font-semibold bg-orange-600 hover:bg-orange-700 text-white px-3.5 py-1.5 rounded-md transition-colors shadow-sm"
              >
                Register
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
