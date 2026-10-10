'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api, CartDetails, ApiError } from './api';
import { useAuth } from './auth-context';

interface CartContextType {
  cart: CartDetails | null;
  isLoading: boolean;
  itemCount: number;
  fetchCart: () => Promise<void>;
  addToCart: (productId: string, quantity?: number) => Promise<void>;
  updateQuantity: (productId: string, quantity: number) => Promise<void>;
  removeFromCart: (productId: string) => Promise<void>;
  clearCart: () => Promise<void>;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [cart, setCart] = useState<CartDetails | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchCart = async () => {
    if (!user) {
      setCart(null);
      return;
    }
    setIsLoading(true);
    try {
      const data = await api.cart.getCart();
      setCart(data);
    } catch (err) {
      console.error('Failed to fetch cart:', err);
      setCart(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchCart();
    } else {
      setCart(null);
    }
  }, [user]);

  const addToCart = async (productId: string, quantity: number = 1) => {
    if (!user) {
      throw new Error('Please log in to add items to your cart.');
    }
    setIsLoading(true);
    try {
      const updated = await api.cart.addItem(productId, quantity);
      setCart(updated);
    } finally {
      setIsLoading(false);
    }
  };

  const updateQuantity = async (productId: string, quantity: number) => {
    setIsLoading(true);
    try {
      if (quantity <= 0) {
        const updated = await api.cart.removeItem(productId);
        setCart(updated);
      } else {
        const updated = await api.cart.updateItem(productId, quantity);
        setCart(updated);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const removeFromCart = async (productId: string) => {
    setIsLoading(true);
    try {
      const updated = await api.cart.removeItem(productId);
      setCart(updated);
    } finally {
      setIsLoading(false);
    }
  };

  const clearCart = async () => {
    setIsLoading(true);
    try {
      await api.cart.clearCart();
      setCart(null);
    } finally {
      setIsLoading(false);
    }
  };

  const itemCount = cart?.item_count || 0;

  return (
    <CartContext.Provider
      value={{
        cart,
        isLoading,
        itemCount,
        fetchCart,
        addToCart,
        updateQuantity,
        removeFromCart,
        clearCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
