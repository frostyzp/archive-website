/**
 * Every confession still available in `public/confession_notes_2/` (served as
 * `/confession_notes_2/<id>.webp`).
 *
 * This is a plain manifest, not a curated selection — the opening loader riffles
 * through a random sample of it, so the more ids listed here the less the intro
 * repeats itself between visits. Vite can't glob `public/`, so the list is
 * static: regenerate it when notes are added with
 *
 *   ls public/confession_notes_2 | sed 's/\.webp//'
 *
 * Ids are NOT contiguous (there are gaps in the AC_ numbering, plus a few _A /
 * _B variants), so never build one from a numeric range — a missing file renders
 * as a broken image.
 */
export const NOTE_STILL_IDS = [
  'AC_001', 'AC_002', 'AC_003', 'AC_004', 'AC_005', 'AC_006', 'AC_007', 'AC_008',
  'AC_009', 'AC_010', 'AC_011', 'AC_012', 'AC_013', 'AC_014', 'AC_015', 'AC_016',
  'AC_017', 'AC_018', 'AC_019', 'AC_020', 'AC_021', 'AC_044', 'AC_045', 'AC_046',
  'AC_047', 'AC_048', 'AC_049', 'AC_051', 'AC_052', 'AC_053', 'AC_054', 'AC_055',
  'AC_056', 'AC_057', 'AC_058', 'AC_059', 'AC_060', 'AC_061', 'AC_062', 'AC_063',
  'AC_064', 'AC_065', 'AC_066', 'AC_067', 'AC_068', 'AC_069', 'AC_070', 'AC_071',
  'AC_072', 'AC_073', 'AC_074', 'AC_075', 'AC_076', 'AC_077', 'AC_078', 'AC_079',
  'AC_080', 'AC_081', 'AC_082', 'AC_083', 'AC_084', 'AC_085', 'AC_086', 'AC_087',
  'AC_088', 'AC_089', 'AC_090', 'AC_091', 'AC_092', 'AC_093', 'AC_094', 'AC_095',
  'AC_096', 'AC_097', 'AC_098', 'AC_099', 'AC_100', 'AC_107', 'AC_108', 'AC_109',
  'AC_110', 'AC_111', 'AC_112', 'AC_113', 'AC_114', 'AC_115', 'AC_116', 'AC_117',
  'AC_118', 'AC_119', 'AC_120', 'AC_121', 'AC_122', 'AC_123', 'AC_124', 'AC_125',
  'AC_126', 'AC_127', 'AC_128', 'AC_129', 'AC_130', 'AC_131', 'AC_132', 'AC_133',
  'AC_134', 'AC_135', 'AC_136', 'AC_137', 'AC_139', 'AC_140', 'AC_141', 'AC_142',
  'AC_143', 'AC_144', 'AC_145', 'AC_146', 'AC_147', 'AC_148', 'AC_149', 'AC_150',
  'AC_151', 'AC_152', 'AC_153', 'AC_154', 'AC_155', 'AC_156', 'AC_157', 'AC_158',
  'AC_159', 'AC_160', 'AC_161', 'AC_162', 'AC_163', 'AC_164', 'AC_165', 'AC_166',
  'AC_167', 'AC_168', 'AC_169', 'AC_170', 'AC_171', 'AC_172', 'AC_173', 'AC_174',
  'AC_175', 'AC_176', 'AC_177', 'AC_178', 'AC_179', 'AC_180', 'AC_181', 'AC_182',
  'AC_183', 'AC_184', 'AC_185', 'AC_186', 'AC_187', 'AC_188', 'AC_189', 'AC_190',
  'AC_191', 'AC_192', 'AC_193', 'AC_194', 'AC_195', 'AC_196', 'AC_197', 'AC_198',
  'AC_199', 'AC_200', 'AC_201', 'AC_202', 'AC_203', 'AC_204', 'AC_205', 'AC_206',
  'AC_207', 'AC_208', 'AC_211', 'AC_212', 'AC_214', 'AC_215', 'AC_216', 'AC_218',
  'AC_219', 'AC_220_A', 'AC_220_B', 'AC_221', 'AC_222', 'AC_223', 'AC_224', 'AC_229',
  'AC_230', 'AC_234', 'AC_235', 'AC_236', 'AC_237', 'AC_239', 'AC_241', 'AC_314',
  'AC_315', 'AC_316', 'AC_317', 'AC_318', 'AC_319', 'AC_320', 'AC_321', 'AC_322',
  'AC_323', 'AC_324', 'AC_325', 'AC_327', 'AC_328', 'AC_329', 'AC_330', 'AC_331',
  'AC_332', 'AC_333', 'AC_334', 'AC_336', 'AC_337', 'AC_338', 'AC_339', 'AC_340',
  'AC_341', 'AC_343', 'AC_344', 'AC_345', 'AC_346', 'AC_347', 'AC_348', 'AC_349',
  'AC_350', 'AC_351_A', 'AC_352', 'AC_353', 'AC_355', 'AC_356', 'AC_357', 'AC_358',
  'AC_359', 'AC_360', 'AC_361', 'AC_362', 'AC_363', 'AC_364', 'AC_365', 'AC_366',
  'AC_367', 'AC_368', 'AC_369', 'AC_372', 'AC_380', 'AC_381',
];
