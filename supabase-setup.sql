-- Run this once in Supabase → SQL Editor → New query → Run

create table products (
  id text primary key,
  name text not null,
  category text,
  price numeric not null,
  compare_at numeric,
  spec jsonb,
  image text,
  description text,
  cj_sku text,
  stock integer
);

create table orders (
  id text primary key,
  created_at timestamptz default now(),
  status text,
  customer jsonb,
  line_items jsonb,
  total numeric
);

insert into products (id, name, category, price, compare_at, spec, image, description, cj_sku, stock) values
('rm-001', 'Aura Mini Projector', 'Home & Tech', 45.00, 79.00,
  '{"resolution": "1080p support", "throw": "40–120in", "connect": "HDMI/USB/WiFi"}',
  'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?w=800',
  'Turns any blank wall into movie night. Small enough to travel, bright enough not to need the lights off.',
  'CJ-PROJ-001', 40),

('rm-002', 'Glow Ambient LED Strip', 'Home & Tech', 18.00, 29.00,
  '{"length": "5m", "control": "App + remote", "modes": "16M colors"}',
  'https://images.unsplash.com/photo-1558002038-1055907df827?w=800',
  'The strip behind every desk setup you''ve screenshotted. Syncs to music, sticks to anything.',
  'CJ-LED-002', 85),

('rm-003', 'Flux Portable Blender', 'Kitchen', 24.00, 38.00,
  '{"capacity": "400ml", "charge": "USB-C", "blades": "6-blade steel"}',
  'https://images.unsplash.com/photo-1570831739435-6601aa3fa4fb?w=800',
  'Blends a smoothie in the time it takes to find your keys. Rinses clean in one motion.',
  'CJ-BLEND-003', 52),

('rm-004', 'Posture Pro Corrector', 'Wellness', 21.00, 34.00,
  '{"size": "Adjustable S–XL", "material": "Breathable mesh", "wear": "Under or over clothes"}',
  'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800',
  'The quiet nudge that fixes a slouch before your back reminds you to.',
  'CJ-POST-004', 60),

('rm-005', 'Clip-On Phone Lens Trio', 'Tech Accessories', 16.00, 27.00,
  '{"lenses": "Wide, macro, fisheye", "mount": "Universal clip", "case": "Included"}',
  'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=800',
  'Three lenses, one clip, zero learning curve. Your phone camera''s actual upgrade.',
  'CJ-LENS-005', 70),

('rm-006', 'Loop Magnetic Charge Cable', 'Tech Accessories', 13.00, 22.00,
  '{"length": "1.2m", "tips": "USB-C, Lightning, Micro", "current": "3A fast charge"}',
  'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=800',
  'One cable, three tips, no more tangled drawer of the wrong ones.',
  'CJ-CABLE-006', 95);
