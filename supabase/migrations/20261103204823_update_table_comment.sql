COMMENT ON TABLE public.admin_settings IS
  'Singleton row (id is always true) of admin-editable global settings. '
  'Currently just trash_retention_days. Read/written exclusively through '
  'api/admin.js action=trash-settings, developer-only for writes.';
