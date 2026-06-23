import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { WO } from '../../../theme/wo';
import { FieldInput } from './fields';
import { flattenComponents, isFieldVisible, FormField } from './form-schema';

interface Props {
  schema: any;
  data: Record<string, any>;
  errors?: Record<string, string>;
  onChange: (key: string, value: any) => void;
}

/**
 * Renders a Form.io template schema natively from its flattened field list,
 * honouring conditional visibility. Validation errors are passed in (computed by
 * the screen on submit). Layout containers are flattened by `flattenComponents`.
 */
export function FormRenderer({ schema, data, errors, onChange }: Props) {
  const { fields } = useMemo(() => flattenComponents(schema), [schema]);
  const visible = fields.filter((f: FormField) => isFieldVisible(f, data));

  if (visible.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTxt}>
          This report has no fields to fill — submitting records that the check was performed.
        </Text>
      </View>
    );
  }

  return (
    <View>
      {visible.map((f) => (
        <FieldInput
          key={f.key}
          field={f}
          value={data[f.key]}
          error={errors?.[f.key] ?? null}
          onChange={(v) => onChange(f.key, v)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { backgroundColor: WO.card, borderRadius: 10, borderWidth: 1, borderColor: WO.line, padding: 16 },
  emptyTxt: { color: WO.textSoft, fontSize: 13.5, lineHeight: 19 },
});
