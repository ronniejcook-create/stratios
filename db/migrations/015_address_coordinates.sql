-- Where an address is on the map: latitude and longitude, found by looking
-- the address up, so properties can be placed on a map.
-- Run after 014_document_photo_notes.sql. Safe to run more than once.

alter table addresses add column if not exists latitude double precision check (latitude between -90 and 90);
alter table addresses add column if not exists longitude double precision check (longitude between -180 and 180);
-- which lookup service gave the location, e.g. 'census'; null when there is none
alter table addresses add column if not exists location_source text;
