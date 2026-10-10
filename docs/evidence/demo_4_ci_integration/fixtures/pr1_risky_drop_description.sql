-- PR #101: Risky Migration Fixture
-- Attempted destructive drop of 'description' column on 'products' table
ALTER TABLE products DROP COLUMN description;
