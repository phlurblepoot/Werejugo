-- Free-form per-family settings (pin appearance defaults, etc.).
ALTER TABLE families ADD COLUMN settings JSONB NOT NULL DEFAULT '{}'::jsonb;
