import { useEffect, useState, type InputHTMLAttributes } from 'react'

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number
  onChange: (value: number) => void
}

/**
 * A number input that tracks its own text while typing, instead of round-tripping
 * every keystroke through a parsed number. A plain controlled <input type="number">
 * commits an empty field as 0 immediately, which redraws the field with "0" before
 * the next digit lands — so clearing "8" to type "7" produces "07". Here, an empty
 * or unparsable field is left alone (not committed) until it parses again; the
 * local text only resyncs from the real value when that value changes.
 */
export function NumberInput({ value, onChange, ...rest }: Props) {
  const [text, setText] = useState(String(value))

  useEffect(() => {
    setText(String(value))
  }, [value])

  return (
    <input
      {...rest}
      type="number"
      value={text}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        const n = Number(raw)
        if (raw.trim() !== '' && Number.isFinite(n)) {
          onChange(n)
        }
      }}
    />
  )
}
