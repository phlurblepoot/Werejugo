-- Pins and trails follow the family's defaults (by kind, cruise line and for
-- everything) unless an item overrides them. The editor used to save the
-- defaults onto every item, so no default ever applied: clear every value that
-- equals a default it could have come from. NULL (or no key) means "inherit".
DO $$
DECLARE
  kd CONSTANT JSONB := '{
    "place":  {"color": "#2563eb", "icon": "pin",      "line": "#2563eb"},
    "food":   {"color": "#ea580c", "icon": "utensils", "line": "#ea580c"},
    "flight": {"color": "#0ea5e9", "icon": "plane",    "line": "#0ea5e9"},
    "cruise": {"color": "#0d9488", "icon": "ship",     "line": "#0d9488"},
    "drive":  {"color": "#7c3aed", "icon": "car",      "line": "#7c3aed"},
    "stay":   {"color": "#db2777", "icon": "hotel",    "line": "#db2777"},
    "custom": {"color": "#64748b", "icon": "star",     "line": "#64748b"}
  }';
  base_pin CONSTANT JSONB := '{"size": 28, "shape": "circle", "borderWidth": 2, "borderColor": "#ffffff"}';
  v RECORD;
  s JSONB; line TEXT;
  k_pin JSONB; f_pin JSONB; l_pin JSONB; k_path JSONB; f_path JSONB; l_path JSONB;
  props JSONB; pin JSONB; path JSONB; key TEXT; dflt JSONB; style TEXT;
  new_color TEXT; new_icon TEXT;
BEGIN
  FOR v IN
    SELECT vi.id, vi.kind, vi.color, vi.icon, vi.properties, f.settings, t.color AS t_color, t.icon AS t_icon
    FROM visits vi JOIN families f ON f.id = vi.family_id LEFT JOIN themes t ON t.id = vi.theme_id
  LOOP
    s := coalesce(v.settings, '{}');
    props := coalesce(v.properties, '{}');
    line := props->>'cruiseLine';
    k_pin := coalesce(s #> ARRAY['pin', 'byKind', v.kind], '{}');
    f_pin := coalesce(s #> '{pin,default}', '{}');
    l_pin := CASE WHEN line IS NULL THEN '{}' ELSE coalesce(s #> ARRAY['pin', 'byLine', line], '{}') END;
    k_path := coalesce(s #> ARRAY['path', 'byKind', v.kind], '{}');
    f_path := coalesce(s #> '{path,default}', '{}');
    l_path := CASE WHEN line IS NULL THEN '{}' ELSE coalesce(s #> ARRAY['path', 'byLine', line], '{}') END;

    new_color := v.color;
    IF lower(v.color) IN (lower(kd #>> ARRAY[v.kind, 'color']), lower(k_pin->>'color'), lower(f_pin->>'color'),
                          lower(l_pin->>'color'), lower(v.t_color)) THEN
      new_color := NULL;
    END IF;
    new_icon := v.icon;
    IF v.icon IN (kd #>> ARRAY[v.kind, 'icon'], k_pin->>'icon', f_pin->>'icon', l_pin->>'icon', v.t_icon) THEN
      new_icon := NULL;
    END IF;

    IF jsonb_typeof(props->'pin') = 'object' THEN
      pin := props->'pin';
      FOREACH key IN ARRAY ARRAY['size', 'shape', 'borderWidth', 'borderColor'] LOOP
        dflt := coalesce(k_pin->key, f_pin->key, base_pin->key);
        IF pin ? key AND (lower(pin->>key) = lower(dflt #>> '{}')
                          OR lower(pin->>key) = lower(l_pin->>key)) THEN
          pin := pin - key;
        END IF;
      END LOOP;
      -- An item's colour and icon live in their own columns.
      pin := pin - 'color' - 'icon';
      props := CASE WHEN pin = '{}' THEN props - 'pin' ELSE jsonb_set(props, '{pin}', pin) END;
    END IF;

    IF jsonb_typeof(props->'path') = 'object' THEN
      path := props->'path';
      style := coalesce(path->>'style', k_path->>'style', f_path->>'style', 'solid');
      FOREACH key IN ARRAY ARRAY['style', 'color', 'width', 'imageUrl'] LOOP
        dflt := CASE key
          WHEN 'style' THEN coalesce(k_path->'style', f_path->'style', '"solid"')
          WHEN 'color' THEN coalesce(k_path->'color', f_path->'color', kd #> ARRAY[v.kind, 'line'])
          WHEN 'width' THEN coalesce(k_path->'width', f_path->'width',
                                     CASE WHEN style IN ('solid', 'dashed', 'dotted', 'image') THEN '3' ELSE '9' END::jsonb)
          ELSE coalesce(k_path->'imageUrl', f_path->'imageUrl', 'null')
        END;
        IF path ? key AND (path->key = 'null' OR lower(path->>key) = lower(dflt #>> '{}')
                           OR lower(path->>key) = lower(l_path->>key)) THEN
          path := path - key;
        END IF;
      END LOOP;
      props := CASE WHEN path = '{}' THEN props - 'path' ELSE jsonb_set(props, '{path}', path) END;
    END IF;

    IF new_color IS DISTINCT FROM v.color OR new_icon IS DISTINCT FROM v.icon OR props IS DISTINCT FROM coalesce(v.properties, '{}') THEN
      UPDATE visits SET color = new_color, icon = new_icon, properties = props WHERE id = v.id;
    END IF;
  END LOOP;
END $$;
