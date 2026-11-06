import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { C, F } from './theme';

export function Btn(props: {
  label: string;
  onPress?: () => void;
  kind?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const kind = props.kind ?? 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      disabled={props.disabled || props.loading}
      style={({ pressed }) => [
        s.btn,
        kind === 'primary' && { backgroundColor: C.fill },
        kind === 'secondary' && { borderWidth: 1, borderColor: C.lineStrong },
        kind === 'ghost' && { height: 44 },
        (props.disabled || pressed) && { opacity: props.disabled ? 0.4 : 0.75 },
        props.style,
      ]}
    >
      {props.loading ? (
        <ActivityIndicator color={kind === 'primary' ? C.fillText : C.red} />
      ) : (
        <Text
          style={[
            s.btnText,
            kind === 'primary' && { color: C.fillText },
            kind === 'ghost' && { fontFamily: undefined, fontSize: 14, letterSpacing: 0, color: C.redSoft, textDecorationLine: 'underline' },
          ]}
        >
          {props.label}
        </Text>
      )}
    </Pressable>
  );
}

export function Label({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.label, style]}>{children}</Text>;
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[s.chip, active && { borderColor: C.red, backgroundColor: '#1A0708' }]}
    >
      <Text style={{ color: active ? C.red : C.redSoft, fontSize: 14, fontWeight: active ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}

/** A row with a label and −/+ buttons. */
export function Stepper(props: { label: string; value: string; onMinus?: () => void; onPlus?: () => void; disabled?: boolean }) {
  return (
    <View style={s.stepRow}>
      <Text style={{ color: C.redDim, fontSize: 14, flex: 1 }}>{props.label}</Text>
      {!props.disabled && (
        <Pressable accessibilityLabel={`Less ${props.label}`} onPress={props.onMinus} style={s.stepBtn}>
          <Text style={s.stepBtnText}>−</Text>
        </Pressable>
      )}
      <Text style={s.stepValue}>{props.value}</Text>
      {!props.disabled && (
        <Pressable accessibilityLabel={`More ${props.label}`} onPress={props.onPlus} style={s.stepBtn}>
          <Text style={s.stepBtnText}>+</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={[s.stat, strong && { borderColor: C.lineStrong }]}>
      <Text style={{ color: C.redDim, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: C.red, fontFamily: F.monoBold, fontSize: 21 }}>{value}</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  btn: { height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnText: { fontFamily: F.displaySemi, fontSize: 16, letterSpacing: 2, color: C.red },
  label: { fontFamily: F.mono, fontSize: 11, letterSpacing: 2.5, color: C.redDim },
  chip: { height: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: C.line, justifyContent: 'center' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48 },
  stepBtn: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { color: C.redSoft, fontSize: 20 },
  stepValue: { minWidth: 72, textAlign: 'center', color: C.red, fontFamily: F.mono, fontSize: 15 },
  stat: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 12, backgroundColor: C.surface, paddingVertical: 8, paddingHorizontal: 10, gap: 2 },
});
