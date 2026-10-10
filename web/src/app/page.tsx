'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Product, FlashSale, formatPrice, ApiError } from '@/lib/api';
import { useCart } from '@/lib/cart-context';
import { useAuth } from '@/lib/auth-context';
import { CountdownTimer } from '@/components/countdown-timer';
import { Zap, ShoppingBag, ShieldCheck, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';

export default function HomePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [flashSales, setFlashSales] = useState<FlashSale[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const { addToCart } = useCart();
  const { user } = useAuth();

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const [prods, sales] = await Promise.all([
          api.catalog.getProducts(),
          api.catalog.getActiveFlashSales(),
        ]);
        setProducts(prods);
        setFlashSales(sales);
      } catch (err: any) {
        setError(err.message || 'Failed to load catalog');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const handleAddToCart = async (productId: string, e: React.MouseEvent) => {
    e.preventDefault();
    if (!user) {
      window.location.href = '/login';
      return;
    }
    setAddingId(productId);
    try {
      await addToCart(productId, 1);
      setSuccessNotice('Item added to multi-vendor cart!');
      setTimeout(() => setSuccessNotice(null), 3500);
    } catch (err: any) {
      alert(err.message || 'Failed to add item to cart');
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="space-y-12">
      {/* Hero Banner */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-orange-600 via-amber-600 to-rose-600 p-8 sm:p-12 text-white shadow-xl">
        <div className="relative z-10 max-w-2xl space-y-4">
          <div className="inline-flex items-center space-x-2 bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold tracking-wide uppercase">
            <Zap className="w-4 h-4 fill-amber-300 text-amber-300" />
            <span>PostgreSQL-Guaranteed Concurrency</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight">
            Flash Deals with Zero Overselling.
          </h1>
          <p className="text-white/90 text-base sm:text-lg">
            Shop exclusive, limited-stock flash sales across independent vendors. Strict row-level transactional
            locks eliminate phantom inventory and checkout race conditions.
          </p>
          <div className="flex flex-wrap gap-4 pt-2">
            <a
              href="#flash-sales"
              className="bg-white text-orange-600 hover:bg-orange-50 font-bold px-6 py-3 rounded-lg shadow-md transition-all flex items-center space-x-2"
            >
              <span>Explore Live Sales</span>
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="#catalog"
              className="bg-white/10 hover:bg-white/20 text-white font-semibold px-6 py-3 rounded-lg backdrop-blur transition-all"
            >
              Browse Full Catalog
            </a>
          </div>
        </div>
        <div className="absolute -right-12 -bottom-12 w-96 h-96 bg-white/10 rounded-full blur-2xl pointer-events-none" />
      </section>

      {/* Success Notification */}
      {successNotice && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center space-x-3 border border-slate-700 animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          <span className="text-sm font-medium">{successNotice}</span>
          <Link href="/cart" className="text-xs text-orange-400 underline font-semibold hover:text-orange-300">
            View Cart
          </Link>
        </div>
      )}

      {/* Error Notice */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-center space-x-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-white rounded-xl h-72 border border-slate-200 p-4 space-y-4">
              <div className="bg-slate-200 h-36 rounded-lg" />
              <div className="bg-slate-200 h-5 w-3/4 rounded" />
              <div className="bg-slate-200 h-4 w-1/2 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Active Flash Sales Section */}
      {!loading && flashSales.length > 0 && (
        <section id="flash-sales" className="space-y-6">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div className="flex items-center space-x-3">
              <div className="bg-red-100 text-red-600 p-2 rounded-lg">
                <Zap className="w-6 h-6 fill-red-600" />
              </div>
              <div>
                <h2 className="text-2xl font-black text-slate-900">Active Flash Sales</h2>
                <p className="text-xs sm:text-sm text-slate-500">
                  Strictly limited stock units • Zero-overselling database lock enforced
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {flashSales.map((sale) => {
              const totalAllocated = sale.quantity_reserved + sale.quantity_sold;
              const available = Math.max(0, sale.quantity_limit - totalAllocated);
              const percentClaimed = Math.min(100, Math.round((totalAllocated / sale.quantity_limit) * 100));
              const isSoldOut = available === 0;

              return (
                <div
                  key={sale.id}
                  className="bg-white border-2 border-red-200 hover:border-red-400 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-4 relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 bg-red-600 text-white text-[10px] font-black uppercase px-3 py-1 rounded-bl-lg tracking-wider">
                    Flash Sale
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between pt-1">
                      <CountdownTimer endsAt={sale.ends_at} />
                      <span className="text-xs font-semibold text-slate-400">
                        Limit: {sale.quantity_limit} units
                      </span>
                    </div>

                    <Link href={`/products/${sale.product_id}`} className="block group">
                      <h3 className="font-bold text-lg text-slate-900 group-hover:text-orange-600 transition-colors line-clamp-2">
                        {sale.product_title || 'Flash Sale Item'}
                      </h3>
                    </Link>

                    {sale.product_description && (
                      <p className="text-xs text-slate-500 line-clamp-2">{sale.product_description}</p>
                    )}
                  </div>

                  <div className="space-y-3 pt-2">
                    {/* Price */}
                    <div className="flex items-baseline space-x-2">
                      <span className="text-2xl font-black text-red-600">
                        {formatPrice(sale.sale_price_minor, sale.currency)}
                      </span>
                      {sale.product && (
                        <span className="text-sm text-slate-400 line-through">
                          {formatPrice(sale.product.price_minor, sale.currency)}
                        </span>
                      )}
                    </div>

                    {/* Stock Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs font-bold">
                        <span className={isSoldOut ? 'text-red-600' : 'text-slate-700'}>
                          {isSoldOut ? 'SOLD OUT' : `${available} units left`}
                        </span>
                        <span className="text-slate-400">{percentClaimed}% claimed</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                        <div
                          className={`h-2.5 rounded-full transition-all duration-500 ${
                            isSoldOut ? 'bg-slate-400' : percentClaimed > 80 ? 'bg-red-500' : 'bg-orange-500'
                          }`}
                          style={{ width: `${percentClaimed}%` }}
                        />
                      </div>
                    </div>

                    {/* Action */}
                    <div className="flex items-center space-x-2 pt-1">
                      <Link
                        href={`/products/${sale.product_id}`}
                        className="flex-1 text-center py-2.5 px-4 rounded-xl border border-slate-300 hover:border-slate-400 font-semibold text-slate-700 text-sm transition-colors"
                      >
                        Details
                      </Link>
                      <button
                        onClick={(e) => handleAddToCart(sale.product_id, e)}
                        disabled={isSoldOut || addingId === sale.product_id}
                        className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-sm text-white transition-all shadow-sm ${
                          isSoldOut
                            ? 'bg-slate-300 cursor-not-allowed'
                            : 'bg-red-600 hover:bg-red-700 active:scale-95'
                        }`}
                      >
                        {isSoldOut ? 'Sold Out' : addingId === sale.product_id ? 'Adding...' : 'Reserve'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Regular Catalog Section */}
      <section id="catalog" className="space-y-6">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-2xl font-black text-slate-900">Marketplace Catalog</h2>
            <p className="text-xs sm:text-sm text-slate-500">
              Browse products from certified multi-vendor stores
            </p>
          </div>
          <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-3 py-1 rounded-full">
            {products.length} Products
          </span>
        </div>

        {products.length === 0 && !loading && (
          <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-300 p-8 space-y-3">
            <ShoppingBag className="w-12 h-12 text-slate-300 mx-auto" />
            <h3 className="text-lg font-bold text-slate-700">No products available yet</h3>
            <p className="text-sm text-slate-400">Products will appear here once vendors publish them.</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {products.map((product) => {
            const isOutOfStock = product.available_qty <= 0;

            return (
              <div
                key={product.id}
                className="bg-white border border-slate-200 hover:border-orange-300 hover:shadow-lg rounded-2xl p-5 flex flex-col justify-between transition-all group"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                      {product.vendor_store_name || 'Vendor'}
                    </span>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                        isOutOfStock ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {isOutOfStock ? 'Out of Stock' : `${product.available_qty} in stock`}
                    </span>
                  </div>

                  <Link href={`/products/${product.id}`} className="block">
                    <h3 className="font-bold text-slate-900 group-hover:text-orange-600 transition-colors line-clamp-2">
                      {product.title}
                    </h3>
                  </Link>

                  <p className="text-xs text-slate-500 line-clamp-2">{product.description}</p>
                </div>

                <div className="space-y-3 pt-4 border-t border-slate-100 mt-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xl font-black text-slate-900">
                      {formatPrice(product.price_minor, product.currency)}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">SKU: {product.sku}</span>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Link
                      href={`/products/${product.id}`}
                      className="p-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-slate-600 text-xs font-medium"
                      title="View Details"
                    >
                      Specs
                    </Link>
                    <button
                      onClick={(e) => handleAddToCart(product.id, e)}
                      disabled={isOutOfStock || addingId === product.id}
                      className={`flex-1 py-2 px-3 rounded-xl font-bold text-xs text-white transition-all ${
                        isOutOfStock
                          ? 'bg-slate-300 cursor-not-allowed'
                          : 'bg-orange-600 hover:bg-orange-700 active:scale-95'
                      }`}
                    >
                      {isOutOfStock ? 'Unavailable' : addingId === product.id ? 'Adding...' : 'Add to Cart'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
