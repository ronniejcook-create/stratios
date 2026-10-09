-- Lets a document be uploaded before its asset exists, so the agent can be
-- handed an Offering Memorandum and asked to create the asset from it.
-- Run after 008_documents.sql. Safe to run more than once.

alter table documents alter column asset_id drop not null;
