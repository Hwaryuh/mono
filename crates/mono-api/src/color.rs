// Ported from packages/domain/src/color.ts. Only as much as is needed for todo/ledger/calendar label color validation:
// normalize_color_to_oklch (parses oklch, or converts hex→oklch). The rest (oklch→hex etc.) can be added when needed.

struct Oklch {
    lightness: f64,
    chroma: f64,
    hue: f64,
}

/// Normalizes oklch(...) or a 6/3-digit hex into an `oklch(L C H)` string. None on a malformed input.
pub fn normalize_color_to_oklch(value: &str) -> Option<String> {
    if let Some(parsed) = parse_oklch(value) {
        return Some(format_oklch(&parsed));
    }
    hex_to_oklch(value)
}

fn parse_oklch(value: &str) -> Option<Oklch> {
    // Numbers, whitespace, and parens are unaffected by lowercasing — only the prefix is matched case-insensitively.
    let lowered = value.trim().to_ascii_lowercase();
    let inner = lowered.strip_prefix("oklch(")?.strip_suffix(')')?;
    let parts: Vec<f64> = inner
        .split_whitespace()
        .map(|token| token.parse::<f64>())
        .collect::<Result<_, _>>()
        .ok()?;
    if parts.len() != 3 {
        return None;
    }
    let (lightness, chroma, hue) = (parts[0], parts[1], parts[2]);
    if !lightness.is_finite() || !(0.0..=1.0).contains(&lightness) {
        return None;
    }
    if !chroma.is_finite() || !(0.0..=0.4).contains(&chroma) {
        return None;
    }
    if !hue.is_finite() || !(0.0..360.0).contains(&hue) {
        return None;
    }
    Some(Oklch { lightness, chroma, hue })
}

fn hex_to_oklch(value: &str) -> Option<String> {
    let (r, g, b) = rgb_of_hex(value)?;
    let red = srgb_to_linear(r);
    let green = srgb_to_linear(g);
    let blue = srgb_to_linear(b);
    let l = (0.412_221_470_8 * red + 0.536_332_536_3 * green + 0.051_445_992_9 * blue).cbrt();
    let m = (0.211_903_498_2 * red + 0.680_699_545_1 * green + 0.107_396_956_6 * blue).cbrt();
    let s = (0.088_302_461_9 * red + 0.281_718_837_6 * green + 0.629_978_700_5 * blue).cbrt();
    let lightness = 0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s;
    let a = 1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s;
    let b_comp = 0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s;
    let chroma = a.hypot(b_comp);
    let hue = if chroma < 0.0005 {
        0.0
    } else {
        (b_comp.atan2(a) * 180.0 / std::f64::consts::PI + 360.0) % 360.0
    };
    Some(format_oklch(&Oklch { lightness, chroma, hue }))
}

fn format_oklch(color: &Oklch) -> String {
    format!(
        "oklch({} {} {})",
        format_channel(color.lightness),
        format_channel(color.chroma),
        format_channel(color.hue)
    )
}

// Equivalent to JS `value.toFixed(3).replace(/\.?0+$/, "")`: rounds to 3 decimals then strips trailing zeros/dot, and "-0"→"0".
fn format_channel(value: f64) -> String {
    let fixed = format!("{value:.3}");
    let trimmed = if fixed.contains('.') {
        fixed.trim_end_matches('0').trim_end_matches('.')
    } else {
        &fixed
    };
    if trimmed == "-0" {
        "0".to_string()
    } else {
        trimmed.to_string()
    }
}

fn rgb_of_hex(value: &str) -> Option<(f64, f64, f64)> {
    let hex = value.strip_prefix('#')?;
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let full = match hex.len() {
        3 => hex.chars().flat_map(|c| [c, c]).collect::<String>(),
        6 => hex.to_string(),
        _ => return None,
    };
    let channel = |slice: &str| u8::from_str_radix(slice, 16).ok().map(|v| v as f64 / 255.0);
    Some((channel(&full[0..2])?, channel(&full[2..4])?, channel(&full[4..6])?))
}

fn srgb_to_linear(channel: f64) -> f64 {
    if channel <= 0.04045 {
        channel / 12.92
    } else {
        ((channel + 0.055) / 1.055).powf(2.4)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_through_normalized_oklch() {
        assert_eq!(
            normalize_color_to_oklch("oklch(0.645 0.009 106.643)").as_deref(),
            Some("oklch(0.645 0.009 106.643)")
        );
    }

    #[test]
    fn trims_trailing_zeros() {
        assert_eq!(normalize_color_to_oklch("oklch(0.500 0.000 0.000)").as_deref(), Some("oklch(0.5 0 0)"));
    }

    #[test]
    fn converts_black_hex() {
        assert_eq!(normalize_color_to_oklch("#000000").as_deref(), Some("oklch(0 0 0)"));
    }

    #[test]
    fn converts_short_hex_and_matches_full() {
        assert_eq!(normalize_color_to_oklch("#fff"), normalize_color_to_oklch("#ffffff"));
    }

    #[test]
    fn converts_arbitrary_hex() {
        // The reference value from color.ts hexToOklch("#b03a55").
        let out = normalize_color_to_oklch("#b03a55").unwrap();
        assert!(out.starts_with("oklch(0.5"), "got {out}");
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(normalize_color_to_oklch("red"), None);
        assert_eq!(normalize_color_to_oklch("#12"), None);
        assert_eq!(normalize_color_to_oklch("oklch(2 0 0)"), None);
        assert_eq!(normalize_color_to_oklch("rgb(0,0,0)"), None);
    }
}
