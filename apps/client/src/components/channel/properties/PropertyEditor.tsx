import type { PropertyDefinition } from "@/types/properties";

import {
  BooleanEditor,
  DatePicker,
  FileUploader,
  MessageRefPicker,
  NumberEditor,
  PersonPicker,
  RecurringEditor,
  SelectEditor,
  TextEditor,
  UrlEditor,
} from "./editors";

export interface PropertyEditorProps {
  definition: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  /**
   * When true, editors that normally wrap themselves in a button trigger +
   * Popover (SelectEditor, PersonPicker) render their content directly so
   * they can be embedded inside an outer popover without nesting.
   */
  inline?: boolean;
}

export function PropertyEditor(props: PropertyEditorProps) {
  const { definition, inline } = props;

  switch (definition.valueType) {
    case "text":
      return <TextEditor {...props} />;

    case "number":
      return <NumberEditor {...props} />;

    case "boolean":
      return <BooleanEditor {...props} />;

    case "single_select":
    case "multi_select":
    case "tags":
      return <SelectEditor {...props} inline={inline} />;

    case "person":
      return <PersonPicker {...props} inline={inline} />;

    case "date":
    case "timestamp":
    case "date_range":
    case "timestamp_range":
      return <DatePicker {...props} />;

    case "url":
      return <UrlEditor {...props} />;

    case "message_ref":
      return <MessageRefPicker {...props} />;

    case "file":
    case "image":
      return <FileUploader {...props} />;

    case "recurring":
      return <RecurringEditor {...props} />;

    default: {
      // Exhaustive check: if a new value type is added, TypeScript will flag this
      const _exhaustive: never = definition.valueType;
      return (
        <p className="text-sm text-muted-foreground">
          Unsupported type: {String(_exhaustive)}
        </p>
      );
    }
  }
}
