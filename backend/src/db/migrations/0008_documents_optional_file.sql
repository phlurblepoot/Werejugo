-- Documents may exist without a file (track an expiry, attach the scan later).
ALTER TABLE documents ALTER COLUMN rel_path DROP NOT NULL;
