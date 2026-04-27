-- Capture UPI reference / UTR / transaction-id from parsed payment text so the
-- same transaction arriving via two channels (forwarded SMS + photo of the
-- same receipt) deduplicates to one row.
--
-- Partial unique index — null is exempt (some bank SMS don't include a ref).

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS upi_reference_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS expenses_user_upi_ref_unique
  ON expenses (user_id, upi_reference_id)
  WHERE upi_reference_id IS NOT NULL;
