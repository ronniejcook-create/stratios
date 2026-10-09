-- Keeps what the agent said about a document's photographs and plan pages
-- (page, what it shows, caption), so pages can be added to the asset's photos
-- later without asking the agent again.
-- Run after 013_photos.sql. Safe to run more than once.

alter table documents add column if not exists photo_notes jsonb;
