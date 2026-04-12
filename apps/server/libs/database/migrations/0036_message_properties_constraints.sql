ALTER TABLE im_message_properties ADD CONSTRAINT chk_single_value CHECK (
  (CASE WHEN text_value IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN number_value IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN boolean_value IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN date_value IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN json_value IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN file_key IS NOT NULL THEN 1 ELSE 0 END) <= 1
);

ALTER TABLE im_channel_property_definitions ADD CONSTRAINT chk_show_in_chat_policy
  CHECK (show_in_chat_policy IN ('show', 'auto', 'hide'));
