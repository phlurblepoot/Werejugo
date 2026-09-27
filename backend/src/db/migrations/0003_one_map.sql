-- Phase 1.6: one map. Map sets go away; every place a family may see is on its map.

-- Keep a family's custom base-map style (from its oldest map set that has one) in its settings.
UPDATE families f
   SET settings = jsonb_set(COALESCE(f.settings, '{}'::jsonb), '{map}',
                            COALESCE(f.settings -> 'map', '{}'::jsonb) || jsonb_build_object('styleUrl', m.style_url))
  FROM (SELECT DISTINCT ON (family_id) family_id, style_url FROM map_sets
         WHERE COALESCE(style_url, '') <> ''
         ORDER BY family_id, created_at) m
 WHERE m.family_id = f.id;

DROP TABLE map_set_visits;
DROP TABLE map_sets;
