-- Idempotent seed data. Safe to re-run: `on conflict` updates existing rows in place
-- rather than duplicating them, so ids stay stable across re-seeds.
--
-- All costs, MOQs, and lead times below are ILLUSTRATIVE — placeholders for demoing the
-- feasibility math, not real supplier quotes. Flagged for review before this app is shown
-- to anyone who might mistake them for real numbers.

insert into categories (slug, display_name, keywords, sort_order) values
  ('canned_beverage', 'Canned Beverage', array['beverage', 'beverages', 'drink', 'drinks', 'soda', 'can', 'cans'], 1),
  ('supplement_capsules', 'Supplement Capsules', array['supplement', 'supplements', 'capsule', 'capsules', 'vitamin', 'vitamins', 'pill', 'pills'], 2),
  ('skincare_serum', 'Skincare Serum', array['serum', 'serums', 'skincare', 'skin care', 'face oil'], 3),
  ('t_shirt', 'T-Shirt', array['t-shirt', 't-shirts', 'tshirt', 'tshirts', 'tee', 'tees', 'shirt', 'shirts'], 4),
  ('water_bottle', 'Water Bottle', array['water bottle', 'water bottles', 'bottle', 'bottles', 'flask', 'flasks'], 5),
  ('candle', 'Candle', array['candle', 'candles'], 6),
  ('coffee_beans', 'Coffee Beans', array['coffee', 'coffees', 'coffee bean', 'coffee beans', 'bean', 'beans', 'roast', 'roasts'], 7),
  ('snack_bar', 'Snack Bar', array['snack bar', 'snack bars', 'bar', 'bars', 'snack', 'snacks'], 8),
  ('pet_treats', 'Pet Treats', array['pet treat', 'pet treats', 'treat', 'treats', 'dog treat', 'dog treats', 'cat treat', 'cat treats'], 9),
  ('tote_bag', 'Tote Bag', array['tote', 'totes', 'tote bag', 'tote bags', 'bag', 'bags'], 10)
on conflict (slug) do update set
  display_name = excluded.display_name,
  keywords = excluded.keywords,
  sort_order = excluded.sort_order;

insert into feasibility_options
  (category, material, material_terms, cost_low, cost_high, moq, lead_time_days_low, lead_time_days_high, assumptions, is_default)
values
  ('canned_beverage', 'Standard Aluminum Can', array['aluminum', 'can', 'metal'], 0.85, 1.20, 5000, 45, 60, 'Illustrative estimate for small-batch overseas can filling; not a supplier quote.', true),
  ('canned_beverage', 'Recycled Aluminum Can', array['aluminum', 'recycled aluminum', 'can', 'metal', 'recycled'], 1.10, 1.55, 5000, 50, 70, 'Illustrative estimate; recycled-content cans typically run a premium over standard stock.', false),

  ('supplement_capsules', 'Vegetable Capsule', array['vegetable capsule', 'vegan capsule', 'capsule', 'hpmc'], 0.06, 0.10, 10000, 30, 45, 'Illustrative estimate for contract-manufactured HPMC capsules at moderate volume.', true),
  ('supplement_capsules', 'Gelatin Capsule', array['gelatin', 'gelatin capsule', 'capsule'], 0.04, 0.07, 10000, 30, 40, 'Illustrative estimate; gelatin capsules are typically cheaper than vegetable-based ones.', false),

  ('skincare_serum', 'Glass Dropper Bottle', array['glass', 'glass bottle'], 1.80, 2.60, 2000, 40, 55, 'Illustrative estimate for 30ml glass dropper bottles, filled and capped.', true),
  ('skincare_serum', 'PET Plastic Bottle', array['plastic', 'pet plastic', 'plastic bottle'], 0.90, 1.40, 2000, 30, 45, 'Illustrative estimate for 30ml PET bottles; lighter and cheaper than glass.', false),

  ('t_shirt', '100% Cotton', array['cotton', '100% cotton'], 3.50, 5.00, 250, 20, 35, 'Illustrative estimate for cut-and-sew cotton tees at small-batch MOQ.', true),
  ('t_shirt', 'Cotton-Poly Blend', array['cotton', 'polyester', 'blend', 'poly-cotton'], 2.80, 4.00, 250, 20, 30, 'Illustrative estimate; blends are typically cheaper and faster than 100% cotton.', false),

  ('water_bottle', 'Stainless Steel', array['steel', 'stainless steel', 'metal'], 3.20, 4.80, 500, 35, 50, 'Illustrative estimate for double-wall insulated stainless bottles.', true),
  ('water_bottle', 'BPA-Free Plastic', array['plastic', 'bpa-free plastic'], 1.10, 1.70, 500, 25, 35, 'Illustrative estimate for single-wall BPA-free plastic bottles.', false),

  ('candle', 'Soy Wax', array['soy wax', 'soy', 'wax'], 2.20, 3.10, 300, 20, 30, 'Illustrative estimate for hand-poured soy wax candles in a standard jar.', true),
  ('candle', 'Paraffin Wax', array['paraffin', 'paraffin wax', 'wax'], 1.30, 1.90, 300, 15, 25, 'Illustrative estimate; paraffin is typically cheaper and faster to source than soy.', false),

  ('coffee_beans', 'Compostable Kraft Bag', array['kraft', 'kraft bag', 'compostable', 'paper'], 0.55, 0.80, 1000, 25, 35, 'Illustrative estimate for a 12oz compostable kraft bag with valve, filled and sealed.', true),
  ('coffee_beans', 'Foil-Lined Bag', array['foil', 'foil-lined', 'mylar'], 0.35, 0.55, 1000, 20, 30, 'Illustrative estimate for a standard foil-lined 12oz bag.', false),

  ('snack_bar', 'Recyclable Paper Wrapper', array['paper', 'paper wrapper', 'recyclable paper'], 0.30, 0.45, 5000, 25, 35, 'Illustrative estimate for a single-serve recyclable paper wrapper, filled and sealed.', true),
  ('snack_bar', 'Flexible Foil Wrapper', array['foil', 'foil wrapper', 'mylar'], 0.18, 0.28, 5000, 20, 30, 'Illustrative estimate for a standard flexible foil wrapper.', false),

  ('pet_treats', 'Recyclable Stand-Up Pouch', array['paper pouch', 'recyclable pouch', 'kraft'], 0.40, 0.60, 3000, 25, 35, 'Illustrative estimate for a recyclable kraft stand-up pouch, filled and sealed.', true),
  ('pet_treats', 'Foil Stand-Up Pouch', array['foil', 'foil pouch', 'mylar'], 0.28, 0.42, 3000, 20, 30, 'Illustrative estimate for a standard foil stand-up pouch.', false),

  ('tote_bag', 'Cotton Canvas', array['cotton', 'canvas', 'cotton canvas'], 1.80, 2.60, 500, 20, 30, 'Illustrative estimate for a printed cotton canvas tote at small-batch MOQ.', true),
  ('tote_bag', 'Recycled Polyester', array['polyester', 'recycled polyester', 'rpet'], 1.40, 2.00, 500, 20, 30, 'Illustrative estimate for a printed rPET tote; typically cheaper than cotton canvas.', false)
on conflict (category, material) do update set
  material_terms = excluded.material_terms,
  cost_low = excluded.cost_low,
  cost_high = excluded.cost_high,
  moq = excluded.moq,
  lead_time_days_low = excluded.lead_time_days_low,
  lead_time_days_high = excluded.lead_time_days_high,
  assumptions = excluded.assumptions,
  is_default = excluded.is_default;
