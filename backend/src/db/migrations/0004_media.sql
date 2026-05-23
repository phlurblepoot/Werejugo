-- Thumbnails and non-image attachments (video/audio) for item media.
ALTER TABLE item_photos ADD COLUMN thumb_url TEXT;
ALTER TABLE item_photos ADD COLUMN media_type TEXT NOT NULL DEFAULT 'image'
  CHECK (media_type IN ('image', 'video', 'audio'));
