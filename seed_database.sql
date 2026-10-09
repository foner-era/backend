INSERT INTO users (name, email, phone, city, address, postal_code, role, status, avatar_url, total_orders, total_spent_pkr, loyalty_points, created_at)
VALUES
('Foner Atelier Director', 'fonerera@gmail.com', '+92 300 1234567', 'Lahore', 'Gulberg III Atelier, Lahore', '54000', 'admin', 'active', '', 12, 495000, 4950, NOW()),
('Sarah Farooq', 'sarah.farooq@example.com', '+92 321 9876543', 'Islamabad', 'F-7/2, Street 14, Islamabad', '44000', 'customer', 'active', '', 3, 92500, 925, NOW())
ON CONFLICT (email) DO NOTHING;

INSERT INTO categories (id, name, slug, description, image_url, accent_color, product_count, featured, sort_order)
VALUES
(1, 'Outerwear', 'outerwear', 'Impeccably tailored coats, trench jackets, and structured overcoats crafted from pure cashmere and wool.', '/products/overcoat.jpg', '#631828', 1, true, 1),
(2, 'Tailoring', 'tailoring', 'Sartorial blazers and precision-cut trousers designed with bespoke silhouettes.', '/products/silk-tailoring.jpg', '#631828', 1, true, 2),
(3, 'Footwear', 'footwear', 'Handwelted leather loafers and formal dress shoes constructed for endurance.', '/products/loafers.jpg', '#631828', 1, true, 3),
(4, 'Leather Goods', 'leather-goods', 'Full-grain calfskin weekenders, briefcases, and travel essentials.', '/products/weekender.jpg', '#631828', 1, true, 4),
(5, 'Knitwear', 'knitwear', 'Superfine merino wool and Mongolian cashmere sweaters for understated layering.', '/products/overcoat.jpg', '#631828', 0, false, 5)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO subcategories (id, name, slug, parent_category_slug, description, image_url, featured, sort_order)
VALUES
(1, 'Cashmere Overcoats', 'cashmere-overcoats', 'outerwear', 'Double-faced Mongolian cashmere overcoats.', '/products/overcoat.jpg', true, 1),
(2, 'Silk Blazers', 'silk-blazers', 'tailoring', 'Hand-tailored silk and wool blazers.', '/products/silk-tailoring.jpg', true, 1),
(3, 'Loafers & Slip-ons', 'loafers-slip-ons', 'footwear', 'Handwelted box-calf leather loafers.', '/products/loafers.jpg', true, 1),
(4, 'Travel Weekenders', 'travel-weekenders', 'leather-goods', 'Full-grain leather travel bags.', '/products/weekender.jpg', true, 1)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO products (id, title, slug, sku, category_slug, subcategory_slug, price_pkr, compare_at_price_pkr, description, fabric_care, seo_title, meta_description, image_url, gallery_urls, sizes, colors, variants, stock, is_featured, is_new_arrival, is_bestseller, rating, reviews_count, units_sold, revenue_pkr)
VALUES
(1, 'Double-Breasted Cashmere Overcoat', 'cashmere-overcoat', 'FNR-COT-001', 'outerwear', 'cashmere-overcoats', 38500, 45000, 'Crafted from pure double-faced Mongolian cashmere, this signature overcoat features broad peak lapels, genuine horn buttons, and an unstructured shoulder for a soft yet commanding drape. Lined in bespoke Bemberg cupro.', '100% Pure Mongolian Cashmere. Lining: 100% Cupro. Specialist dry clean only.', 'Double-Breasted Cashmere Overcoat | Foner Atelier', 'Pure double-faced Mongolian cashmere overcoat with horn buttons and peak lapels.', '/products/overcoat.jpg', ARRAY['/products/overcoat.jpg', '/banners/desktop-banner-1.jpg'], ARRAY['38R', '40R', '42R', '44R'], '[{"name":"Oxblood Burgundy","hex":"#631828"},{"name":"Warm Camel","hex":"#C5A06E"},{"name":"Atelier Midnight","hex":"#1F181A"}]', '[{"id":"v1-1","size":"38R","color":"Oxblood Burgundy","sku":"FNR-COT-001-38R-OXB","stock":5,"price_pkr":38500},{"id":"v1-2","size":"40R","color":"Oxblood Burgundy","sku":"FNR-COT-001-40R-OXB","stock":8,"price_pkr":38500},{"id":"v1-3","size":"42R","color":"Oxblood Burgundy","sku":"FNR-COT-001-42R-OXB","stock":4,"price_pkr":38500},{"id":"v1-4","size":"40R","color":"Warm Camel","sku":"FNR-COT-001-40R-CAM","stock":6,"price_pkr":38500}]', 23, true, true, true, 4.9, 14, 42, 1617000),
(2, 'Sartorial Silk Tailored Blazer', 'silk-tailoring', 'FNR-BLZ-002', 'tailoring', 'silk-blazers', 29500, 34000, 'An architectural single-breasted blazer woven from fine mulberry silk and virgin wool. Cut with a tapered waist, pick-stitched lapels, and double side vents for fluid movement.', '60% Mulberry Silk, 40% Virgin Wool. Dry clean only.', 'Sartorial Silk Tailored Blazer | Foner Atelier', 'Fine mulberry silk and virgin wool tailored blazer with hand pick-stitching.', '/products/silk-tailoring.jpg', ARRAY['/products/silk-tailoring.jpg', '/banners/desktop-banner-2.jpg'], ARRAY['38R', '40R', '42R', '44R'], '[{"name":"Oatmeal Beige","hex":"#F7F3EB"},{"name":"Deep Burgundy","hex":"#631828"}]', '[{"id":"v2-1","size":"38R","color":"Oatmeal Beige","sku":"FNR-BLZ-002-38R-BEI","stock":6,"price_pkr":29500},{"id":"v2-2","size":"40R","color":"Oatmeal Beige","sku":"FNR-BLZ-002-40R-BEI","stock":9,"price_pkr":29500},{"id":"v2-3","size":"42R","color":"Oatmeal Beige","sku":"FNR-BLZ-002-42R-BEI","stock":3,"price_pkr":29500}]', 18, true, true, false, 4.8, 8, 21, 619500),
(3, 'Handwelted Calfskin Loafers', 'handwelted-loafers', 'FNR-SH-003', 'footwear', 'loafers-slip-ons', 24500, 28000, 'Constructed using traditional Goodyear handwelting from box-calf leather. Features a burnished apron, stacked leather heels with rubber insert, and cushioned vegetable-tanned insoles.', '100% French Box-Calf Leather. Condition regularly with neutral beeswax polish.', 'Handwelted Calfskin Loafers | Foner Atelier', 'French box-calf Goodyear-welted loafers with burnished apron and leather sole.', '/products/loafers.jpg', ARRAY['/products/loafers.jpg'], ARRAY['40 EU', '41 EU', '42 EU', '43 EU', '44 EU'], '[{"name":"Antique Bordeaux","hex":"#58111A"},{"name":"Espresso Brown","hex":"#3B2317"}]', '[{"id":"v3-1","size":"41 EU","color":"Antique Bordeaux","sku":"FNR-SH-003-41-BOR","stock":4,"price_pkr":24500},{"id":"v3-2","size":"42 EU","color":"Antique Bordeaux","sku":"FNR-SH-003-42-BOR","stock":7,"price_pkr":24500},{"id":"v3-3","size":"43 EU","color":"Antique Bordeaux","sku":"FNR-SH-003-43-BOR","stock":5,"price_pkr":24500}]', 16, true, false, true, 5.0, 19, 58, 1421000),
(4, 'Handcrafted Calfskin Weekender', 'calfskin-weekender', 'FNR-BAG-004', 'leather-goods', 'travel-weekenders', 34000, 40000, 'The definitive luxury travel bag. Made from supple vegetable-tanned full-grain leather with antique brass two-way riri zippers, reinforced base studs, and a detachable padded shoulder strap.', 'Full-Grain Vegetable-Tanned Cowhide. Heavyweight cotton drill lining.', 'Handcrafted Calfskin Weekender | Foner Atelier', 'Full-grain vegetable-tanned leather travel weekender bag with solid brass hardware.', '/products/weekender.jpg', ARRAY['/products/weekender.jpg'], ARRAY['One Size (48L)'], '[{"name":"Rich Cognac","hex":"#8B4513"},{"name":"Sable Black","hex":"#1C1917"}]', '[{"id":"v4-1","size":"One Size (48L)","color":"Rich Cognac","sku":"FNR-BAG-004-OS-COG","stock":8,"price_pkr":34000},{"id":"v4-2","size":"One Size (48L)","color":"Sable Black","sku":"FNR-BAG-004-OS-BLK","stock":6,"price_pkr":34000}]', 14, true, true, true, 4.9, 12, 37, 1258000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO banners (id, title, subtitle, badge_text, cta_text, cta_link, desktop_image_url, mobile_image_url, device_target, theme_style, sort_order, is_active)
VALUES
(1, 'The Autumn / Winter Atelier', 'Signature double-faced Mongolian cashmere overcoats, silk-blend tailoring, and handwelted leather footwear.', 'New Season', 'Explore Collection →', '/products', '/banners/desktop-banner-1.jpg', '/banners/mobile-banner-1.jpg', 'both', 'dark', 1, true),
(2, 'Handcrafted in Lahore', 'Every garment is constructed in our Gulberg III atelier with master tailors and artisans.', 'Expert Craft', 'Discover Process →', '/categories', '/banners/desktop-banner-2.jpg', '/banners/mobile-banner-2.jpg', 'both', 'light', 2, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO store_settings (setting_key, setting_value) VALUES
('store_name', '{"value":"FONER"}'),
('tagline', '{"value":"Tailored outerwear, knitwear, and leather goods."}'),
('footer_description', '{"value":"Tailored outerwear, knitwear, and leather goods."}'),
('currency', '{"value":"PKR"}'),
('currency_symbol', '{"value":"Rs."}'),
('delivery_fee_pkr', '{"value":300}'),
('free_shipping_note', '{"value":"Flat Rs. 300 nationwide delivery across Pakistan"}'),
('announcement_bar', '{"value":"Nationwide delivery across Pakistan — Rs. 300 flat shipping rate"}'),
('contact_email', '{"value":"fonerera@gmail.com"}'),
('business_email', '{"value":"fonerera@gmail.com"}'),
('business_phone', '{"value":"+92 300 1234567"}'),
('business_address', '{"value":"Gulberg III Atelier, Lahore, Pakistan"}'),
('support_phone', '{"value":"+92 300 1234567"}'),
('support_email', '{"value":"fonerera@gmail.com"}'),
('atelier_address', '{"value":"Gulberg III Atelier, Lahore, Pakistan"}'),
('instagram_url', '{"value":"https://instagram.com/foner"}'),
('facebook_url', '{"value":"https://facebook.com/foner"}'),
('whatsapp_number', '{"value":"+92 300 1234567"}'),
('footer_copyright_text', '{"value":"© 2026 FONER. All rights reserved."}'),
('footer_bottom_note', '{"value":"Nationwide shipping across Pakistan — Rs. 300"}')
ON CONFLICT (setting_key) DO NOTHING;
