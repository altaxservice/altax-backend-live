-- Documents for people who are not (yet) a client: a lease between two outside parties, a prospect's agreement, an NDA with a vendor.
-- The client link becomes optional; such documents are visible to admins and to the staff member who created them.
ALTER TABLE altax.v3_client_contracts ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE altax.v3_doc_builder_docs ALTER COLUMN client_id DROP NOT NULL;
