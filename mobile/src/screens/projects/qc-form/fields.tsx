import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../theme/colors';
import { WO } from '../../../theme/wo';
import { FormField } from './form-schema';

interface FieldProps {
  field: FormField;
  value: any;
  onChange: (value: any) => void;
  error?: string | null;
}

function Label({ field }: { field: FormField }) {
  return (
    <View style={styles.labelRow}>
      <Text style={styles.label}>{field.label}{field.required ? <Text style={styles.req}> *</Text> : null}</Text>
    </View>
  );
}

function TextLikeField({ field, value, onChange, multiline }: FieldProps & { multiline?: boolean }) {
  return (
    <TextInput
      style={[styles.input, multiline && styles.textarea]}
      value={value == null ? '' : String(value)}
      onChangeText={onChange}
      placeholder={field.placeholder || ''}
      placeholderTextColor={Colors.textSecondary}
      multiline={multiline}
      keyboardType={field.type === 'number' ? 'numeric' : 'default'}
    />
  );
}

function OptionRows({ field, value, onChange, multi }: FieldProps & { multi?: boolean }) {
  // single: value is a string; multi: value is { [optionValue]: boolean }
  const selected = (opt: string) => (multi ? !!(value && value[opt]) : value === opt);
  const toggle = (opt: string) => {
    if (multi) onChange({ ...(value && typeof value === 'object' ? value : {}), [opt]: !selected(opt) });
    else onChange(value === opt ? '' : opt);
  };
  return (
    <View style={styles.optionWrap}>
      {field.options.map((o) => {
        const on = selected(o.value);
        return (
          <TouchableOpacity key={o.value} style={[styles.option, on && styles.optionOn]} onPress={() => toggle(o.value)} activeOpacity={0.7}>
            <Ionicons
              name={multi ? (on ? 'checkbox' : 'square-outline') : (on ? 'radio-button-on' : 'radio-button-off')}
              size={18}
              color={on ? WO.accent : Colors.textSecondary}
            />
            <Text style={[styles.optionTxt, on && styles.optionTxtOn]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function CheckboxField({ field, value, onChange }: FieldProps) {
  const on = value === true;
  return (
    <TouchableOpacity style={[styles.option, on && styles.optionOn]} onPress={() => onChange(!on)} activeOpacity={0.7}>
      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? WO.accent : Colors.textSecondary} />
      <Text style={[styles.optionTxt, on && styles.optionTxtOn]}>{field.label}</Text>
    </TouchableOpacity>
  );
}

function DateTimeField({ field, value, onChange }: FieldProps) {
  const stamp = () => onChange(new Date().toISOString());
  const display = value ? new Date(String(value)).toLocaleString() : '';
  return (
    <View style={styles.dateRow}>
      <TextInput
        style={[styles.input, { flex: 1 }]}
        value={value ? display : ''}
        onChangeText={onChange}
        placeholder="Tap “Now” or type a date"
        placeholderTextColor={Colors.textSecondary}
      />
      <TouchableOpacity style={styles.nowBtn} onPress={stamp}>
        <Ionicons name="time-outline" size={15} color={WO.accent} />
        <Text style={styles.nowTxt}>Now</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Renders one field by its type. `checkbox` is self-labelling; others show a Label. */
export function FieldInput(props: FieldProps) {
  const { field, error } = props;
  const body = (() => {
    switch (field.type) {
      case 'textfield': return <TextLikeField {...props} />;
      case 'textarea': return <TextLikeField {...props} multiline />;
      case 'number': return <TextLikeField {...props} />;
      case 'select': return <OptionRows {...props} multi={field.multiple} />;
      case 'radio': return <OptionRows {...props} />;
      case 'selectboxes': return <OptionRows {...props} multi />;
      case 'checkbox': return <CheckboxField {...props} />;
      case 'datetime': return <DateTimeField {...props} />;
      default: return null;
    }
  })();

  return (
    <View style={styles.field}>
      {field.type !== 'checkbox' && <Label field={field} />}
      {field.description ? <Text style={styles.desc}>{field.description}</Text> : null}
      {body}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  labelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  label: { fontSize: 13.5, fontWeight: '700', color: WO.text },
  req: { color: WO.bad, fontWeight: '800' },
  desc: { fontSize: 12, color: WO.textSoft, marginBottom: 6 },
  input: { backgroundColor: WO.card, borderRadius: 10, borderWidth: 1, borderColor: WO.line, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: WO.text },
  textarea: { minHeight: 88, textAlignVertical: 'top' },
  optionWrap: { gap: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: WO.card, borderRadius: 10, borderWidth: 1, borderColor: WO.line, paddingHorizontal: 12, paddingVertical: 11 },
  optionOn: { borderColor: WO.accent, backgroundColor: WO.infoBg },
  optionTxt: { fontSize: 14, color: WO.text, fontWeight: '600', flex: 1 },
  optionTxtOn: { color: WO.accent },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nowBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: WO.accent, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  nowTxt: { color: WO.accent, fontWeight: '800', fontSize: 13 },
  error: { color: WO.bad, fontSize: 12, marginTop: 5, fontWeight: '600' },
});
