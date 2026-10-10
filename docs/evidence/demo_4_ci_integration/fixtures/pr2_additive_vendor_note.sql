-- PR #102: Backward-compatible Additive Migration
-- Adding nullable 'vendor_note' column to 'orders' table
ALTER TABLE orders ADD COLUMN vendor_note TEXT;
