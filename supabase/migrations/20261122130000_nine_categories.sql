-- Nine product categories (Pet Care: 7, Sasthya Seba: Index + Optimum) and a first,
-- name-based sorting of existing products. Staff fix any misplaced item in Inventory.
DO $$
DECLARE
  _pcv_food uuid; _pcv_med uuid; _pcv_acc uuid; _pcv_other uuid; _ss_ayur uuid; _ss_herbal uuid;
  _dry uuid; _wet uuid; _litter uuid; _acc uuid; _med uuid; _otherfood uuid; _groom uuid; _index uuid; _optimum uuid; _service uuid;
BEGIN
  SELECT id INTO _pcv_food  FROM product_categories WHERE project='pcv' AND name='Pet Food';
  SELECT id INTO _pcv_med   FROM product_categories WHERE project='pcv' AND name='Pet Medicine';
  SELECT id INTO _pcv_acc   FROM product_categories WHERE project='pcv' AND name='Accessory';
  SELECT id INTO _pcv_other FROM product_categories WHERE project='pcv' AND name='Other';
  SELECT id INTO _service   FROM product_categories WHERE project='pcv' AND name='Service';
  SELECT id INTO _ss_ayur   FROM product_categories WHERE project='ss'  AND name='Ayurvedic';
  SELECT id INTO _ss_herbal FROM product_categories WHERE project='ss'  AND name='Herbal';

  -- Keep ids where a category simply gets its new name.
  UPDATE product_categories SET name='Dry Food', sort=1, is_active=true WHERE id=_pcv_food;
  UPDATE product_categories SET name='Accessories', sort=4, is_active=true WHERE id=_pcv_acc;
  UPDATE product_categories SET name='Cat Medicine', sort=5, is_active=true WHERE id=_pcv_med;
  UPDATE product_categories SET name='Index Laboratories', sort=8, is_active=true, legacy_category='medicine' WHERE id=_ss_ayur;
  _dry := _pcv_food; _acc := _pcv_acc; _med := _pcv_med; _index := _ss_ayur;

  INSERT INTO product_categories(name, project, legacy_category, sort, is_active) VALUES ('Wet Food','pcv','pet_food',2,true) RETURNING id INTO _wet;
  INSERT INTO product_categories(name, project, legacy_category, sort, is_active) VALUES ('Cat Litter','pcv','accessory',3,true) RETURNING id INTO _litter;
  INSERT INTO product_categories(name, project, legacy_category, sort, is_active) VALUES ('Other Pet Food','pcv','pet_food',6,true) RETURNING id INTO _otherfood;
  INSERT INTO product_categories(name, project, legacy_category, sort, is_active) VALUES ('Grooming Products','pcv','accessory',7,true) RETURNING id INTO _groom;
  INSERT INTO product_categories(name, project, legacy_category, sort, is_active) VALUES ('Optimum Pharmaceuticals','ss','medicine',9,true) RETURNING id INTO _optimum;
  UPDATE product_categories SET sort=99 WHERE id=_service;

  -- Pet Care products
  WITH c AS (
    SELECT p.id, lower(p.name) n, p.category_id cid, p.category::text leg FROM products p WHERE p.project='pcv'
  ), k AS (
    SELECT id,
      CASE
        WHEN cid=_service OR n ~ '(delivery charge|korea charge|xray|servi?sce|service|doctor fee|injection cost)' THEN _service
        WHEN n ~ 'litter' AND n !~ '(box|scope|scoop|mat\M|deo)' THEN _litter
        WHEN n ~ '(shampoo|shmpoo|comb|brush|trimmer|nail|clipper|perfume|fur remover|odor remover|grooming|bioline kitten|baby powder|toothpaste|cleanser|losion|lotion)' THEN _groom
        WHEN n ~ '(collar|coller|scratch|catnip wall|litter|jacket|basket|muzzle|lint remover|water battle|feeding kit|bowl|toy|harness|\mbag\M|dispenser|feeder|carry)' AND n !~ '\d+ ?kg' THEN _acc
        WHEN cid=_pcv_food OR n ~ '(kaniva|cat food|dog food|pouch|pounch|\mcann?\M|canned|gravy|jelly|pate\M|loaf|mousse|creamy|wet food|wet cat food|grain free|treat|biscuit|biscute|hand feeding|cat grass|teething stick|bird|\mbrid\M|seed mix|\d+(\.\d+)? ?kg|\mkitten\M.*\d|(adult|kitten|age).*\d+ ?(gm|g|gram)\M)' THEN
          CASE
            WHEN n ~ '(bird|\mbrid\M|seed mix|rabbit|dog food|truly dog|treat|biscuit|biscute|hand feeding|cat grass|teething stick|tiodo|tred\M|trid\M)' THEN _otherfood
            WHEN n ~ '(pouch|pounch|\mcann?\M|canned|gravy|jelly|pate\M|paste|loaf|mousse|creamy|wet)' THEN _wet
            ELSE _dry
          END
        WHEN cid=_pcv_med OR leg='medicine' THEN _med
        ELSE _acc
      END AS new_cid
    FROM c
  )
  UPDATE products p SET category_id = k.new_cid,
    category = (SELECT legacy_category FROM product_categories WHERE id = k.new_cid)
  FROM k WHERE p.id = k.id AND p.category_id IS DISTINCT FROM k.new_cid;

  -- Sasthya Seba: Ayurvedic + Herbal = Index Laboratories, the rest = Optimum Pharmaceuticals
  UPDATE products SET category_id = CASE WHEN category_id IN (_ss_ayur, _ss_herbal) THEN _index ELSE _optimum END,
    category = 'medicine'
  WHERE project = 'ss';

  -- Old categories that are now empty are hidden (kept, so history stays readable).
  UPDATE product_categories pc SET is_active = false
  WHERE pc.id NOT IN (_dry,_wet,_litter,_acc,_med,_otherfood,_groom,_index,_optimum,_service)
    AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = pc.id);
END $$;
