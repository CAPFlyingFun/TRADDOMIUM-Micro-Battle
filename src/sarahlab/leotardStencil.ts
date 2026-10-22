/**
 * THE LEOTARD'S FRONT OPENING, TRACED FROM JOSHUA'S OWN LINES (2026-10-21).
 *
 * He drew the front of the leg openings on a close-up of her at belly 0% (red lines along the creases at the tops of
 * her thighs, the crotch as wide as the gap between them). A line worked out from her body map could not follow them:
 * a crease is a fold, and her thigh's skin just below it stands as high up her trunk as her groin's just above. So his
 * line was laid onto her skin instead: every vertex of her approved body (sarah-v2-body.glb, 115710 vertices) was
 * projected through the same camera as that close-up, and each one that camera sees face-on (facing it, and not
 * hidden behind nearer skin) near the line was marked by which side of it it falls, softened over about 5 screen
 * pixels. The mark belongs to the vertex, so it stays on the same skin at every
 * belly size and in every pose.
 *
 * Encoding: for each marked vertex in index order, the gap from the previous index as a 7-bit varint, then its cover
 * (0-255: 0 bare, 255 covered) and how much the mark decides there (0-255): fully across the crotch and the creases,
 * fading out before the outer ends of his line, where the template's own line over her hips (which already follows
 * his there) takes over.
 */
export const LEOTARD_FRONT_STENCIL = Object.freeze({
  vertices: 115710,
  entries: 6653,
  data:
  'zXAAAgEABQEABgEADgEACAEAEwEAGgEAIAEAKgEALgEFOgEAOQEAKwEAHgEAEQEADAEAFgEAIwEANgEAQgEFSgEjSAEgUwFGXAEeYQEEWQEASg' +
  'EAOwEAKwEAGwEAEAEABgEAEAEAHwEANQEARgEAUAEAWgEIbAEAXwEAXAEAbgEDfAEAewEAaQEAVwEAQwEALQEAHgEAEAEABQEAAgIABAEAAg0A' +
  'BAEABwEAFAEAFAEAJgEANwEASQEAWwEATAEAawEAgAEAjAEFjwEhiQE6eAFAawFmcQFoZQGMagGugQF0hQFSjwE9nAEjoAEOogECmgEAlAEBpg' +
  'EApAEAjwEAfgEAkQEApQEAcQEAXQEATgEAcgEAkAEAowEAlQEAmwEAUwEAeQEAMgEAIwEAOAEAEwEAFQEAIAEADgEACAEAAQEABAMABQEAArAB' +
  'EwIBCwQBAAMBAAECAAUBAAgBBAgBEg8BRw8BVAkBOQQBTAMBaAEBmQUBeAcBmw4BvwsB7QkBrAIC+gQJ/wIB/wMB/wgB/w0B/xAB+hMB2xIByh' +
  'YBoRYB1B4B8hkB/x4B/xgB/xkB/yAB/ysB/CYB3ioBkh4BRBYBIBcBARABAAsBAAYBAA0BAA4BABUBABoBABIBBxcBAhoBAyEBACoBFi0BKzsB' +
  'BToBI0gBSE0BRlwBcVoBaGUBjGoBlGABuGoBroEB4XYB44kB9YUB8Y0B9HkB/nsB/osB9G4B2GEBrFoBjVYBaEoBZjwBNzIBIykBSy0BIiABVB' +
  '8BhCYBWScBijIBtiwB2DIB0DoBsEMBlUsBvlIB4E4B914B/2oI/1UB/1oB+1EB/0wB90QB8TYB+zAB/zIB/z0B/0cB/zsB/zUB/ykB/yAB/xYB' +
  '/xAB/wsB/xQB/xgB/x4B/ygB/zIB/z0B/0EB/0wr/wWzAv8BiwEACgEAAgEAEQEACgEAFgEAJAEALwEAJwEASQEASAEANAEAVwEAagEAXgEAYQ' +
  'EAPwEAQgEAYwEAXQEAhAEAMAEAHgEAHAEACgEABwMABwIAGwEAKQEAOgEAXQEAgQEAdQEAVAEAgQEAPQEALAMAUvUNAAICAAoBAA4BABYBACcB' +
  'ABIBACMBADQBABoBADcBAFYBAFcBAFIBAEgBAFgBAEABACgBABkBABEBAAcZAAIBAAkBAAUBABIBACOQIv/AA//QAf/VAf/TAf++Af+tAf+TAf' +
  '+ZAf+EIP9eAf9dAf9vAf9uAf99Af+CAf+SAf+CAf+WAf+pAf+nAf/BAf+8Af+pAf+aAf+JAf91Af9qAf9dAv9lAf9tAv9nBP9yBP+PAf+EAf+Z' +
  'Af+qAf+tAf+rAf+dAf+KAf91Af92Af9+Af+OAf+IAf+gAf+dAf+sAf+4Af+9Af+xAf+2Af+yAf/BAf+6Af/AAf+/Af++Af/QAf/TAf/lAf/kAf' +
  '/vAf/zAf/5Af/xAf/7Af/xAf/gAf/SAf/MAf/ZAf/dAf/pAf/pAf/zAf/7Af/6Af/1Af/tAf/4Af/9Af//Af//Af//Af//Af/7Af//Af//Af//' +
  'Af//Af//Af//Af/9Af/2Af/vAf/hAf/JAf/GAf/MAf/KAf/QAf/XAf/iAf/jAf/tAf/wAf/5Af/fAf/XAf/YAf/gAf/sAf/mAf/aAf/tAf/1Af' +
  '/2Af/9Af//Af//Af//Af//Af//Af//Af//Af//Af//Af/9Af/8Af/5Af/5Af//Af/+Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//' +
  'Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af' +
  '//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//' +
  'Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af' +
  '//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//' +
  'Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af' +
  '//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//' +
  'Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af' +
  '//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//' +
  'Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af' +
  '//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//' +
  'Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af' +
  '//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//' +
  'Af//Af//Af//Af//Af//Af//Af//Af//Af//c/9dxgf/YgL/XQH/cQH/bwH/ggH/hwH/cgH/YwP/dwH/cwH/fgH/mAH/jAH/jwH/gwH/lQH/qw' +
  'H/qAH/oAH/rgH/swH/uQH/wQH/vAH/zgH/yQH/2gH/3gH/5wH/4gH/7QH/8AH/7gH/+AH/9QH//AH//gH//QH//wH//wH//wH//wH//wL//wH/' +
  '/wH//wH//wH//gH/9wH/6QH/2gH/0QH/ygH/wwH/wgH/0wH/5AH/8AH/7AH/4wH/1gH/yQH/uQH/qgH/oAH/sAH/vQH/sgH/mAH/kgH/pwH/wQ' +
  'H/zQH/2AH/5QH/7gH/8wH/+QH//gH//wH//wH//wH//wH//wH//gH/+AH/8wH//AH/+AH/7gH/4gH/4QH/1gH/1wH/4wH/7gH/7QH/+QH/+AH/' +
  '/gH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//gH//gH//wH//wH//wH//wH//wH//wH//wH//w' +
  'H//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH/' +
  '/wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//w' +
  'H//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH/' +
  '/wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//w' +
  'H//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH/' +
  '/wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//w' +
  'H//wH//wH//wH//wH//wH//wT//wH//wH//wH//wH//wH//wH//wv//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH/' +
  '/wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//w' +
  'H//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH/' +
  '/wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//w' +
  'H//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH/' +
  '/wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//40R/3ME/4MB/4UB/5UR/6kB/5wB/5' +
  'IB/6kB/6sB/7wB/7kB/8kB/6wB/7QB/8AB/8cB/8QB/9cB/9oB/+IB/+cB/+4B/+cB//UB//gB//0C//8G/9ZD//9A///EBAAPAQAeAQApmRT/' +
  '5AH/5gH/8QH/7wH/8AH/+wH/+QH/+gH/3wL/5gcADAEABAEABQEADgEAIAEAEgEACQEAIwEAPgEAQAEAWAEAOAEAaAEAUwEAeQEAhAEAhQEApA' +
  'EAmQEAmwEAcgEAtwEAxgEAsgEAlQEAowEAkAEAuAEApQEAkQEApAECugEEtAEBpgEKrAECmgEOogEarQEjoAEvtAFMrAE9nAFjoQFSjwF3sQGR' +
  'owF2lgGRkgGwmgG1qQHLpQHUlwHmpQHrlgHjiQL4kwHxjQH1hQH+iwP+exTarAHLsgGltgGFwgFjuwFKvAFkzAE7xAEfuwEOugEMvgESwwEZwg' +
  'ElygEYyAETywEEyQEAygED2QEH1QES1gER3gEY3gEe2wEb0wEczgEr1wEq4AEk4wEb5QEV5QEN4wEA3wEA4wEAyAEA7gEH7wEP6gEU5wEh7AEd' +
  '8QEl+AEW+QEE+wEA6gEAywEAsAEAmgEAlQEAugEA1gEAtwEAdgEAWwEAXgEAWAEAdQEAfgEAkQEAfwEAqAEA4AEA8gEA/gEA/QEN/wEA/wEA/w' +
  'EA9gEAtAEAwAEAqQEA3QEA6gEA+AEA/wEA/wEA/wEF/wEq/wFW/wFP/wEy/wEu/wEP/wEp/wEt/gE7/QE//gFF/wFL/wFR/wFX/wFp/wFs/wF8' +
  '/wFi/wFN/wEx/wEA/wEA/wEA/wEA/wEA/QEA/wEA/wEA/wEA/wEA/wEA/wEA/wEO/wEA/wEA/wEA/wEV/wFK/wFj/wGG/wGe/wGE/wGq/wGf/w' +
  'G0/wGO/wGd/wGT/wFp/wE9/wEB/wFw/wFz/wGF/wF8/wFz/wFy/wFv/wFy/wF3/wF1/wFc/wFU/wFJ/gFC/QFE+wFM/QFQ/wFa/wFg/wFn/wF0' +
  '/wFp/wFh/wFW/gFQ/AFL+QFY/AFl/gFn/AFd+QFD9QE39QEx8AEq6gE06AE88AFP9QFW7wFE4QFG1AFf1wFc3gFp5wF53gGS0gGtyQHCvxCv1g' +
  'Gh3A2j5wGL6wig+QGJ8wFt+QF0/QF0/gGE/wF8/wF8/wF8/wGG/wGN/wGD/wGE/wF5/wGL/wGH/wGJ/wGM/wGO/wGJ/wGV/wGV/wGd/wGn/wGo' +
  '/wGO/wGM/wGK/wGF/wGX/wOy/wOZ/wF1/wGE/wGH/wGJ/wGN/wGQ/wGN/wGb/wGj/wGr/wG3/wGz/wG2/wG1/wHA/wG9/wG3/wG6/wG7/wG3/w' +
  'G6/wG2/wG//wHM/wHG/wG+/wG5/wG0/wG4/wGw/wG6/wGp/wGb/wGb/wGO/wGp/wG6/wHD/wHQ/wHG//IS/+6LF5GSAbCaAdSXAeOJAXaWAWOh' +
  'KtD/A8z/AsD/Ar3/FcX/AcL/Ab7/Abr/AcD/Ab3/Abr/Abz/Aar/AbT/Abf/Abb/AbT/AZ7/AbP/AbD/AYb/Abz/AcD/Ab7/Ab//AcT/AcP/Ac' +
  'b/Acf/AcX/AcX/Ac//Hv/zAf/mAf/3Af/wAf/6Af/+Af/+Af/7Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//' +
  'Af//Af//Af//Af//Af//Af//Af//Af//Af//Af/9Af/+Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Bf//Af//DP//Af//Af//Af//Af' +
  '//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//J83/Acr/AcT/Acb/Acf/Acj/Acj/Ab7/AbX/AaT/AXX/' +
  'AUr/AUz/AQ7/AQb/AQD/AQD/AQD/AQD/AQD/AQD/AQP/AQD/ASj/AVv/AYr/AZP/Abr/Aa7/Aa//AZ3/AXT/AUP/AYj/Aar/Abn/Ab//Ab//Ac' +
  'D/AcX/AcX/Acj/Acf/AcP/Ab3/Ab//AcD/AcD/AcH/AcT/Acb/AcX/AcX/Acb/Acj/AcX/DM//Ac//Acr/AcT/AcD/AcT/Acb/AcT/AcX/Acn/' +
  'Acb/AcX/Acf/AcX/AcD/Ab7/AcT/Acb/Acn/Ac3/Acv/Acf/Acn/Acf/Ab//AcD/AcH/AcD/AcD/Abz/Ab7/AcL/Abf/Abv/AbX/AaL/AWT/AS' +
  'f/AQL/AQD/AR3/ARn/AQL/AUr/AUj/AYT/AXT/AUn/ARr/AYL/AWP/AZ7/Aav/AbT/Abr/Ab7/Ab3/AbT/Aa//AbH/AbP/Abn/AcD/AcL/AcL/' +
  'Ab7/Abj/Abb/Abn/AbX/AbT/AbX/AbP/AbT/Aar/AZ//AYf/AUn/AZ7/AZv/AXX/AaP/AaL/Aaj/Aaz/Aaj/Aaj/Aaz/Aav/Aa//Aa3/Aaj/Aa' +
  'r/Aa7/AaX/AaH/AZ//AZ//AZ7/AZ//AaH/AZ7/AaD/AZv/AZz/AaL/AZ//AZ7/AaL/Abf/Abr/Adr/Abb/Acj/Ab7/AbH/Aa3/Aa7/AbH/Abb/' +
  'AbX/AcP/Acf/AcP/AcT/AcP/AcP/A9b/Ae//Avn/AsP/AcD/Ab//Ab7/Ab3/Ab3/AcD/Ab//Abz/Ab7/Ab//AcL/Ab3/AcD/AcP/AcL/AcH/A/' +
  'GNAeOJAeuW6g4AVgEAVwEAawEAagEAcwEAUgEAfgEAWAEAqQEAkQEAmwEAxwEAwAEA6gEA5AEA/QEA/wEA/QEA/wEA/wEA/wEA/wEA/wEA/wEA' +
  '/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/AEA6wEAzAEArwEAjwEAkgEAcQEAXgEAYQEAjgEAgQEAYwEAhAEAngEAsgEAuAEAqAEAwAEA2Q' +
  'EA1gEA3AEAyQEAsAEAgQEAXQEAoAEAkgEAdQEAgQEAowEArAEAvQEA1QEA5AEA5AEA0AEAvRwA4AIA9AEA9QEA/QEA+AEA6wEA5wEA9gEA6gEA' +
  '8AEA/QEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/AEA9QEA/gEA/wEA/wEA/wEA/wwA/wEA/wEA/wEA/wEA/w' +
  'EA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEC/wEA/wEA/wEA/wEa/wEZ/wER/wEA/wEB/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA' +
  '/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/xcA/wEA/wEA/wEA/wEA/wEA/wIA/wUA/wEA/wEA/wEA/w' +
  'EA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA' +
  '/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wMA/wEA/w' +
  'EA/zIA/wEA/xkP/wEA/wEA/wEi/wEA/wEt/wEg/wEA/wEx/wEO/wEA/wEB/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA' +
  '/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wIA/wEA/wEA/w' +
  'EA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA' +
  '/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/2H//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//w' +
  'H//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH/' +
  '/wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//w' +
  'H//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH/' +
  '/wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//w' +
  'H//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH/' +
  '/wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//w' +
  'H//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//5Qe' +
  'kPoBq/0Jj/4BpP+iHf//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af' +
  '//Af//Af//Av//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//' +
  'Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af' +
  '//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//EP//Jv//Af//Av//Af//Af//' +
  'Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af7/Af//Afj/AfT/Af7/AfT/Ad' +
  '7/Af3/Af//Af//Cv//Af//Af//Af//GP//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//' +
  'Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//B///Af//Af//Af//Af//Af//Af//Af//Af//A///Af//Af//Af//Af//Af//Af//Af//Af' +
  '//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//qQ7//wH//w3//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH/' +
  '/wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//w' +
  'H//wH//wH//wH//wH//wH//wH//wH//xD//wH//wH//wH//5AE//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//++G8H/AcL/Acf/' +
  'vw1J/wEa/wFj/wFJ/wER/wFL/wF1/wGH/wF+/wGe/wGb/wGe/wGj/wGk/wGh/wGf/wGg/wGe/wGb/wGc/wGb/wGf/wGh/wGe/wGe/wGZ/wGY/w' +
  'GU/wGY/wGQ/wGX/wGb/wGa/wGT/wGU/wGQ/wGR/wGL/wGM/wGK/wGK/wF5/wFW/wEg/wEB/wEA/wEZ/wEC/wEA/wEA/wEA/wEW/wE5/wFM/wF0' +
  '/wGF/wGG/wGF/wGF/wGG/wGE/wF5/wF9/wF6/wF5/wFv/wFa/wFF/wES/wEA/wEA/wEA/wEK/wE6/wEj/wEF/wEA/wEA/wEA/wEN/wEx/wFC/w' +
  'FJ/wFV/wFL/wFB/wEl/wEO/wEE/wEB/wEA/wEO/wEB/wEc/wEj/wE7/wE+/wE9/wFJ/wFP/wFP/wFQ/wFT/wFT/wFS/wFT/wFY/wFX/wFX/wFW' +
  '/wFV/wFS/wFU/wFY/wFa/wFW/wFZ/wFh/wFj/wFq/wFt/wFx/wF1/wF5/wFz/wFx/wFv/wFw/wFu/wFr/wFu/wFq/wFt/wFq/wFv/wFr/wFf/w' +
  'Fa/wFa/wFb/wFX/wFZ/wFi/wJ3/wFs/wFi/wFo/wFq/wFt/wFv/wFu/wFv/wFv/wFu/wFu/wFu/wFv/wGM/wF2/wFw/wFx/wFv/wFv/wFw/wF6' +
  '/wFv/wFv/wFv/wFx/wFz/wGb/wGZ/wGZ/wGk/wG6/wGi/wG2/wHK/wHe/wHa/wH1/wH4/wH0/wH//wH//wH//wH//wH//wH//wH//wH//wH//w' +
  'H//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH//wH/' +
  '/wH+/wH//wH//wH5/wH1/wH1/wH0/wHX/wGy/wGV/wKU/wG1/wHY/wHl/wHO/wHG/wG5/wGi/wRZ/wFW/wFX/wFX/wFY/wFQ/wFI/wFP/wFI/w' +
  'E7/wE3/wFE/wFH/wFQ/wFU/wFZ/wFZ/wFU/wFL/wFJ/wFV/wFO/wFI/wFE/wFQ/wFT/wFY/wFW/wFT/wFN/wFH/wFP/wFW/wFV/wFa/wFc/wFS' +
  '/wFI/wE0/wEh/wER/wEW/wEp/wE4/wFE/wFO/wFX/wFP/wFM/wE9/wE+/wFI/wFX/wFb/wFg/wFj/wFn/wFe/wFd/wFa/wZn/wFj/wFk/wST/w' +
  'GZ/wGs/wGo/wGi/wRp/wFd/wFR/wE7/wFP/wE5/wEq/wEo/wEf/wEc/wEO/wEs/wE5/wEx/wFH/wFJ/wFb/wFU/wFT/wFM/wEg/wFO/wEt/wFW' +
  '/wFf/wF1/wFo/wFh/wFm/wFj/wFp/wFm/wFt/wJ0/wFx/wF2/wJz/wF5/wGF/wR+/wN3/wFv/wFr/wFm/wF1/wF//wqE/xVo/xmO/wFl/wFh/w' +
  'Fh/wFa/wFY/wFU/wFZ/wFu/wF7/wFu/wFi/wFk/wFz/xjQ/wHH/wHB/wa+/wHS/wHg/wHo/wHf/wHD/wVo/wNy/wFk/wFt/wJh/wFY/wFV/wFW' +
  '/wFJ/wFH/wFH/wE+/wFN/wFV/wFd/wEu/wEw/wEu/wE5/wE2/wE//wFL/wFa/wFj/wFl/wFT/wFL/wFD/wFP/wFI/wFE/wE7/wE7/wFK/wFT/w' +
  'FZ/wFc/wJk/wFn/wFd/wFj/wFa/wFX/wFN/wFI/wFB/wFQ/wFb/wFg/wFS/wFG/wE5/wE9/wFL/wFU/wFb/wFl/wFi/wFc/wFb/wFP/wFS/wFJ' +
  '/wFS//MEAP8BAP8BAP8DAP8BAP8BAP8BAP8xAP8LAP8BAP8BAP8BAP8xAP+qGE//AWj/AVb/AS3/AXX/AnD/AYT/AXn/A4L/AWD/ASL/AU//AT' +
  'r/AQ//AUf/AWD/AXf/B4b/+AG//wHc/wH2/wG9/wHy/wH8/wH//wH//wH+/wH7/wHx/wHl/wHZ/wHQ/wHh/wHa/wHp/wHk/wHi/wHz/wH9/wH3' +
  '/wHx/wHr/wH0/wH8/wH4/wH//wH//wH//wH//wH//wH//wH//wH//60X//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B' +
  '//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8C//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8c//0B//8G//8B//8B//8B//0B//UB/+0C/+oB/94B/+MB/+IB/+wB//QB/+MB/9QB/8kB/9MB/78B/7UB/60B/6EB/7AB' +
  '/8gB/9EB/7cB/8gB/7YB/9oB/+IB/+4B//MB//wB//gB//UB/+kB/+MB//EB//sB//sB//4B//8B//8B//4B//gB/+wB//IB/+gB/9wB/9MB/8' +
  'EB/8gB/7oB/68B/6AB/5gB/5wB/5AC/4QL/2oB/18D/2sB/1wB/3YB/4IB/34B/5MB/5MB/4kB/4UB/5wB/6MB/6kB/5sB/7gB/8IB/60B/80B' +
  '/9UB/94B/+wB/+QB/9gB/+0B//AB//YB//oB//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8N//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B' +
  '//8B//8B//8B//8B//8B//8B//8B//8B//8B//0B//oB//sB//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8D//8I//8B//8B//8B' +
  '//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B' +
  '//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8C//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//9o//8B//8B//8B' +
  '//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B' +
  '//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8G//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B' +
  '//8B//8B//8g//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B9/8B7P8B4v8B6/8B+/8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8H//8B//8B//8S//8c//8B//8B//8B//8B//8B//8B//8B//8H//8B//8B//8B//8B//8C//8B' +
  '//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//0B//4B//cB//EB' +
  '/+sB//EB/+IB/98B/+IB/+cB//QB//wB//8B//8B//8B//8B//4B//YB/+cB/+sD//gB//0B//8B//4T/94B/9UB/9QB/9MB/9IB/90B/8YB/8' +
  'EB/80B/68B/7AB/8UB/8cB/7YG/5oB/5QB/58B/44B/5wB/4sB/4EB/3gF/3hT//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B' +
  '//8B//8B//8B//8B//8B//8G//8B//8B//8B//8D//8B//8B//8B//93nf8Bl/8Bm/8Co/8Blf8Bgv8Bdf8Biv8Bjv8Bl/8BoP8BqP8Bs/8Bvf' +
  '8BtP8Brv8BqP8Bof8Bm/8BmP8Biv8Bff8Bd/8Bbf8Bcv8Bdf8Bev8Bkv8Bnf8Bof8Bo/8Bqv8Bq/8Brv8Bsf8Buf8Byf8V/f8B8P8B8/8B+/8B' +
  '9v8B8v8B7v8B7v8B7f8B7/8B7P8B7P8B6/8B7f8B6f8B6P8B6v8B7P8B7/8B7v8B6v8B7v8B7P8B7f8B8P8B8P8B7v8B7f8B7f8B7f8B6/8B7P' +
  '8B6v8B6f8B6P8B5v8B5P8B4/8B4v8B3v8B1f8B0f8Bz/8B0f8B0P8B0/8B1f8B2f8B2f8B2P8B1f8B2f8B3P8B2P8B3/8B2v8B3f8B2/8B2/8B' +
  '3/8B4P8B3f8B3v8B3v8B3/8B0P8Bwv8B4/8B4f8B4f8B4v8B4v8B4v8B5f8B4f8B4/8B4/8B4/8B5P8B5f8B6P8B6/8B7/8B6f8B5/8B5P8B5f' +
  '8B5P8B2P8BlP8Bo/8BQv8BHv8Bkv8BFv8BAP8BAP8BAP8BEP8BV/8Bqf8Bbf8BG/8BAP8BAP8BCv8BAP8BAP8BH/8BAP8BAP8BAP8BAP8BAP8B' +
  'AP4BAPsBAP8BAPIBAPMBANABAOYBAP0BAP8BFP8BLv8Bd/8Bev8BeP8Ba/8BZv8Bef8Bdf8BbP8BVP8BHP8BAP8BAPUBANwBAMcBAKABALoBAK' +
  '8BAH8BAGoBAH8BAFUBADwBADgBAB0BACABABIBADcBACcBAE8BAKYBAMgBAOsBAP4BAP8BDP8BOf8BR/8BQ/8BUP8BWP8BXP8BX/8BWP8Bcf8B' +
  'Z/8BZf8BYP8BWP8BR/8BSP8BVv8BV/8BWP8BWv8BYv8BZ/8BcP8Bbf8Bc/8Bd/8Bdf8Bc/8Bbf8Ba/8Bav8BZf8BXf8BZv8Bdf8Bbf8Bcv8BeP' +
  '8Bd/8BdP8Bb/8BUP8BMf8BAPwBANkBALYBAIMBAFcBADMBABIBAAwBAAUBAAsBAAICAAYBAAQBABMBACYBABUBACABADoBADMBAEkBAG8BAFEB' +
  'AGMBAFkBAH8BAGUBAJABAHIBAJUBAJwBB7ABDp8BMJ0BPLcBXLQBYr8BXscBPM0BALwBALoBAJsBALoBAM8BAOsBANUBANIBHdMBVN4BPeYBDO' +
  '0BGfoBKf8BRP8BV/8BZv8BcP8BbP8BdP8BeP8Bc/8Bcv8Bcf8Bdv8Bh/8BjP8Bi/8Blv8Bqf4BvvwB1foB6PQC/OcI/84M/0MC/0gQ/1kB/1QB' +
  '/0QB/2cB/14B/0wB/1YB/2gB/2AB/28B/3gG/7YB/8AB/7QB/6wB/6kB/50B/58B/6gB/7kB/8cB/9YB/uAB990B6ukB1O4By/UBvfkBrPsBq/' +
  'gBtvUBvPABr/IBpvQBpe4BwOcB1+cB3d8BwdsBqd8BoOUBkuoBku4BjfQBofcBofoBlvkBl/wBlv4BjP8Bev8Bff8Bcf8Bbf8Bdf8Bhf4Biv0B' +
  'jvwBjfoBifgBhfUBifcBffQBe/MBivIBi/ABkO4BjuwBjO0BiOkBj+MBlNwBp9MB0s8B79MB+9IB/soB98sB6sYB+8AB/78B/q4B67UBzr0Bqc' +
  'IBjcoBjNMBhNoBbdEBdMkBe7wBkLMBrK8BzqwB6J8BsZwBlKMBj6oBbqsBfKEBfJUBUpYBSHYBi38BaGsBlXEByoABsmMB5nQB84gB/JwB/50B' +
  '/44B/HsB72IB/3EB/4QB/5MB/4sB/4EB/3UB/1gB/3sB/34B/45n//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B' +
  '//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B' +
  '//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B' +
  '//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B' +
  '//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B' +
  '//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B' +
  '//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B' +
  '//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B' +
  '//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B' +
  '//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//' +
  '8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B//8B///pHv//Af//Af//' +
  'Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Aez/Aez/Af3/Af' +
  '//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af3/AfP/Aej/Ad7/Adn/AdH/Acf/Adb/Ae//Af7/Af//Af//Af//Af//' +
  'Af//Af//Af//Af//Af//Afv/Af7/Af3/Af//Afj/Aff/AeX/AdD/Ab3/Ab7/Abn/Abj/Abf/Abf/Abb/Abn/AcL/AcX/AdH/AdL/AdX/Adb/Ad' +
  'b/AeL/AdH/Acz/Ac3/Ac3/Ac//Ac3/AdD/AdD/AdD/Ac//Ac//AdD/AdD/AdH/AdH/Ac//Acv/Acj/AcH/AcH/Acb/Acn/Acr/AdH/Ac//Ac//' +
  'AdD/Ac7/Ac//Ac7/Ac7/Ac//AdD/Ac//AdP/Acr/AbD/AcP/AdL/AdH/Ac//Acv/Ac3/Ab7/AXP/AXb/Aav/AcX/AcH/Ab7/Ab7/Ab7/Abr/Ab' +
  '7/Ab3/Abv/Abj/Abn/Abz/Ab3/Abj/Abb/AbX/AbX/AbX/AbP/AbD/AbH/Aa//AbD/AbH/AbL/AbT/Abf/Abn/Abv/Abn/AbX/AbL/AbH/AbH/' +
  'AbP/Aa//AbT/AbL/Aa//Abj/Abb/Abn/Abr/Abv/Aan/Abb/Abf/Abf/Abj/Abv/Abz/Abz/Aa//AZ//AXP/AYT/Aaj/Aa7/Aa//AbD/Aa7/Ab' +
  'D/Aa7/Aa//Aan/AZ7/AWr/AUv/AUz/ARr/ATL/AV7/AZH/AbX/Abz/Abn/Ab7/Abz/AVj/ARz/AQH/AQD/ASL/AWD/AZT/Aa//AbL/AbH/Abf/' +
  'AbL/AbD/AbT/Arf/AbX/Abj/Abj/Abn/AbH/AbX/Abj/A7f/Abb/Abb/Abf/AbX/Abj/Abj/AbX/Aav/AZz/AbD/AbX/Abb/AbX/Abb/AbX/Ab' +
  'b/A7T/AbH/Aa7/AaL/AYb/AaP/Aaz/Aa3/AbP/ArH/AbH/Aaz/AaD/AXz/AUf/ARj/AQP/AQD/ARL/AT3/AXv/AUn/ARb/AQD/AQD/AQD/AQD/' +
  'AQD/AQD/AQD/AQD/ARP/AQD/AQD/ARf/ATP/AS7/AS7/AQD/AUL/AR7/AZT/AYj/AcT/AcL/AdD/Adb/Adj/Adr/Adn/Adn/AdP/Ac//AdD/Ac' +
  'v/Acz/Ac7/Ac//Acv/Ac7/Acz/Acz/Ac3/Acv/Acv/kwfx/wHr/wH0/wHv/wHk/wHi/wHp/wHk/wHU/wHa/wHh/wHQ/wHZ/wHB/wG+/wHS/wG0' +
  '/wG0/wHF/wHb/wHq/wHz/wH4/wH4/wH3/wH8/wHx/wHn/wHw/wH0/wHx/wHs/wHg/wHb/wHM/wHJ/wHa/wHq/wHN/wG7/wG8/wGu/wGq/weq/w' +
  'Gu/xvt/wSy/wG0/wGx/wGx/wGu/wGy/wi7/wG4/wGx/wK9/wG1/wGg/wGs/wG7/wG//wG6/wGx/wG1/wG9/wHC/wG//wG+/wG4/wGt/wGy/wGb' +
  '/wGj/wGS/wGF/wFw/wGR/wGi/wG0/wG//wW5/wSy/wG1/wG1/wG2/wG4/wK4/wG3/wG1/wG9/wGs/wGa/wF9/wGh/wGy/wGt/wGy/wG0/wG1/w' +
  'G0/wGy/wGv/wGx/wGw/wGv/wGw/wGv/wGp/wGm/wGj/wGt/wGv/wGt/wGh/wGh/wGs/wGw/wGu/wGw/wGp/wGt/wGr/wGd/wGh/wGX/wGV/wGj' +
  '/wFA/wEi/wEA/wEB/wEA/wEA/wEA/wEA/wEA/wEL/wE1/wFT/wFw/wFp/wFN/wEW/wEH/wEA/wEi/wED/wFL/wFo/wFn/wFB/wGI/wFq/wF8/w' +
  'GH/wGO/wGm/wGv/wG6/wPB/wG+/wHA/wGz/wGe/wGc/wGS/wGR/wGk/wG6/wG9/ySU/wGQ/wGI/wZm/wFf/wRS/wFM/wFN/wFL/wFS/wFV/wFT' +
  '/wFN/wFK/wFe/wFW/wFd/wFj/wRv/wFv/wFj/wFh/wFX/wFa/wFm/wGf/wGt/wGi/wGh/wFh/wFh/wFl/wFu/wOF/wGM/wGQ/wOP/wGb/wGV/w' +
  'GX/wGe/wGg/wGo/wGc/wGZ/wGh/wGl/wGt/wGi/wGb/wGQ/wGX/wGO/wGd/wGw/wGz/wGi/wGc/wGt/wGl/wGw/wG1/wG7/wG9/wLA/wK8/wG6' +
  '/wGx/wGm/wGv/wWm/wGo/wKv/wG3/wG5/wGy/wGl/wGe/wGq/wGy/wGw/wGv/wGu/wGq/wGe/wGn/+gMT/8CS/8CRP8PQ/8BTv8TOP8BOf8BM/' +
  '8CI/8BI/8BNP8BP/8BSv8BRf8BS/8BA/8BBf8BAP8BAf8BAP8BAP8HDf+uA///Af//Af//Af//Af//Af//Af//Af//rwoA/wEA/wUA/wEA/wEA' +
  '/wEA/wEA/wEA/wEA/wEA/ycA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/w' +
  'EA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wED/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA' +
  '/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wkA/wEA/wEA/wEA/wEA/wEA/wEA/w' +
  'EA/wEA/wEA/wEA/xkA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA' +
  '/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/w' +
  'EA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wQA/wEA/gEA/wEA/wEA/AEA/wEA/wEA/wEA/wEA' +
  '/AEA6gEA8gEA7QQA2gEA5QEA0wEAvwEAvA4ApQEArAEAvAEA1gEAxwEA4wEA8QEA/QEA/wEA+wEA8wEA4wEAuwEAsAEAnwEAkQEAggEAjAEAaA' +
  'EAXQEAeAEAheUCS/8BUf8BSf8SAP8BAP8HAP+YAgD/AQD/AQD/AQD/AQD/XQD/AwD/AQD/AQD/AQD/AgD/2wEA/wEA/wEA/wEA/wEA/wEA/9wB' +
  'q/+9Bf//Af//Af//Af//Af//Af//Af//Af//Af//lgIA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/w' +
  'EA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEe/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA' +
  '/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/wEA+wEA/gEA8wEA+wEA6QEA/AEA/wEA+AEA8Q' +
  'EA/wEA/wEA/wEA/wEA/wEA/wEA/wEA/gEA/wEA9gEA7wEA6QEA4QEA0QEAywEA0AEAugEAmAEAoAEAfwEAdwEAWgEAagEAOAEAYgEAOwEAiwEA' +
  'sAEAtQEAxwEA2gEA0AEAnwEAaAEASwEAdQEAXgEAoAEAtAEAQgG//wHF/wHG/9QL7P8B7P8B7P8B7v8B7f8B7f8B7v8B7P8B7v8B7/8B7v8B2P' +
  '8B6P8B5f8B6f8B6P8B6f8B5v8B2/8B2v8B5P8B6/8B6f8B6f8B6/8B6P8B6/8B6f8B6v8B6v8B7P8B6v8B6v8B6f8B6v8B5/8B6P8B7P8B6f8B' +
  '6v8B6/8B7P8B4/8Bz/8B5/8B6f8B7P8B7/8B6/8B7/8B7v8B7f8B7f8B6/8B6f8B7f8B6/8B6/8B7P8B7f8H2v8B3f8B2v8B4P8B4/8B5P8B4/' +
  '8B5f8C6v8E8P8B7/8B7/8B7v8B7v8B8P8B7/8B7v8B7P8B7P8B7f8B8P8B6/8B4/8B7P8B6/8B7P8B7f8B7P8B7f8B6/8B7P8B7f8B6P8B6f8B' +
  '6/8B7P8B7f8B5/8B6/8B6/8B6P8B6v8B5/8B5/8B5f8B5f8B4/8B4P8Bvf8BUP8BQ/8Bgf8BdP8Bs/8Bpf8BsP8BpP8Br/8Btv8Bu/8BvP8Bv/' +
  '8Bwv8Bxv8By/8Bzf8Bzv8B0/8B0P8B0v8B1f8B0v8Bzv8Byv8ByP8Bx/8Bxf8BwP8BxP8Bxf8Bxv8Byv8Bzv8B1P8B1P8B1/8B2f8B2v8B2v8B' +
  '3P8B3v8B4v8B5v8B5P8B5f8B5/8B6P8B5v8B5f8B5v8B5f8B3f8B3P8B4/8B5/8B6P8B5v8B5f8B5f8B4/8B4v8B3v8B2/8B2v8B2v8B2/8B2/' +
  '8B3P8Bt/8B1f8B2P8B2v8B2P8B1v8B1f8B2P8B2P8B0/8B4/8B4/8B3v8B4v8B7f8B7v8B8P+OIP//Af//Af//Af//Af//Af//Af//Af//Af//' +
  'Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af' +
  '//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//' +
  'Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af' +
  '//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//' +
  'Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af' +
  '//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af/+Af/+Af/6Af/4Af/3Af/xAf/tAf/i' +
  'Af/dAf/fAf/NAf/SAf/XAf/BAf+vAf+tAf+fAf+cAf+pAf+5Af/KAf/AAf+0Af+pAf+ZAf+LAf+IAf94Af94Af9/Af+MAf+ZAf+oAf+bAf+XAf' +
  '+lAf+fAf+xAf+vAf/AAf+/Af/AAf+2Af+5Af/NAf/bAf/mAf/rAf/2Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//' +
  'Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af/+Af/+Af/4Af' +
  '/qAf/dAf/lAf/uAf/1Af/oAf/aAf/HAf/SAf/PAf/NAf/CAf/YAf/cAf/tAf/gAf/qAf/3Af/7Af//Af//Af//Af//Af//Af//Af//Af//Af//' +
  'Af/9Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af//Af/+Af/2Af/xAf/ntxvF/wHC/wG+/wHB/wG7/wG8/wG1/wGx/w' +
  'Gt/wGu/wGr/wGn/wGn/wGh/wGa/wGS/wGL/wGJ/wF4/wFx/wFp/wFu/wFp/wFl/wFe/5gNuP8Bsv8Bq/8Bqv8Bo//zC/+QAv+nAf+hAf+1Af++' +
  'Af/JAf/TAv+uKP/jAf/eAf/tlxxx/wFz/wF1/wFw/wFx/wFy/wF0/wF4/wFn/wFl/wFh/wFm/wFn/wFl/wFk/wFl/wFg/wFl/wFd/wF0/wF7/w' +
  'GH/gF9/wGF/gGG/QGJ/QGP/AGQ/AGP/AGK+gGL+QGJ9wGJ9wF79wGK+QGJ+wGF/QF6/gFy/AF0+QFV8wFF+AFb/gFy/gFp/wFf/wFo/wFO/wFX' +
  '/wFb/wFe/wFQ/wFw8AGF8AGK7wF26gF55AFw2gEWggEQZAECaAEAViJz/wFs/wFu/wFn/wFp/wFm/wFr/wFq/wFs/wFo/wFt/wFk/wFc/wFf/w' +
  'Fo/wFn/wFm/wFo/wFr/wFt/wFs/7wzAE8CAIUeADMBACYBACQBABQCAAgTAAIBAAQBAAUBAA0BACgBAFABAHgBAF0BADEBAGgBAEsBABsBADUB' +
  'AF4BAEIBAA0BAAoBAAEBAAkBABUBAAwBAAQCAATvBgBiAQBCAQA7AQAuAQA1AQAeAQAbAQAbAQA4AQBaAQAdAQAUAQALAQASAQAEAQACEwANAQ' +
  'AKAgABkwwsWgFoawFIdgEQZAFtXwGVcQGyYwFzUwE0SgEGQAEASgEAWAECaAEAVgEAQgEAQwEAZQEAWQEAMwEAIQEAIAEANgEAOAEAIgEAKwEP' +
  'NQFPQwGOTAHDUAHvYgHmdAGdQAHCPwFwMQFsPAEsMQEbIQFeIQEbGQEsFQEADQERDAEABQEABgIOBUQAAgIABAEABgEAEwEAFQEACgEABQQAAg' +
  'EADAEBFQEAFgEADQEAIQEAHAEAEwEABgEADCX/cQHvYgH/WAHqTwHDUAHCPwHzRAH/SwH/YAH/VgH/RAH/TAH/PAH4OAHaNgGnLwFwMQFeIQGv' +
  'JwFwHAEsFQFUFAERDAGpHAHiKQHcMAH/LgH/OAH/OwH/RAH/VAH/OQH/PgH/SAH/OwH/QwH/OAH/NAH/MgH/LQH/LQH/JQHoIQG+FgH0GgH/IA' +
  'H/IgH/KgH/LgH/MAH/OAH/OgL/OgL/MQH/MAH/JgH/JwH/Kkv/GgL/IQH/JQH/HwH/FwH/Dwj/BwH/CAH/CAH/DQH/FAH/HQH/HwH/JgH/GwH/' +
  'GAH/EgH/CgH/BQH/AwH/AwH/A44C/wIB/wkB/xEB/xYB+BQB1BIBmw4BwwsB9Q0B/w4B/wkB8wgBxwYBegQBXgcBNQIBDwEDjgIBywMB9QUB/w' +
  'QC5gIIDgUBVgoBZw8BMg0BAAWHB/98Af+KAf95Af9tzAEAAQH/rQH/qQH/wgH/vwH/rwH/oQH/nwH/mwH/kQH/iQH/lwH/jAH/ewH/fwH/cgH/' +
  'eAP/bgP/cwH/gAH/iQH/kwH/fgH/egH/cAH/Zg3/XAL/YQH/bQH/aw==',
});

let decoded: { cover: Float32Array; weight: Float32Array } | null = null;
/** The stencil for a body of `vertices` vertices: null unless it is the body it was traced on. */
export function leotardFrontStencil(vertices: number): { cover: Float32Array; weight: Float32Array } | null {
  if (vertices !== LEOTARD_FRONT_STENCIL.vertices) return null;
  if (decoded) return decoded;
  const bin = globalThis.atob(LEOTARD_FRONT_STENCIL.data), cover = new Float32Array(vertices), weight = new Float32Array(vertices);
  let at = 0, v = -1;
  while (at < bin.length) {
    let gap = 0, shift = 0, byte = 0;
    do { byte = bin.charCodeAt(at++); gap |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
    v += gap;
    cover[v] = bin.charCodeAt(at++) / 255; weight[v] = bin.charCodeAt(at++) / 255;
  }
  return (decoded = { cover, weight });
}
