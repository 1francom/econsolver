# Spatial gaps validation fixtures.
#
# Run from project root:
#   Rscript src/math/__validation__/spatialGapsRValidation.R
#
# Requires: sf, spdep
# Outputs:
#   src/math/__validation__/spatialGapsBenchmarks.json

library(sf)
library(spdep)

out_dir <- file.path("src", "math", "__validation__")

A <- st_as_sfc("POLYGON((500000 6000000,500010 6000000,500010 6000010,500000 6000010,500000 6000000))", crs = 32721)
B <- st_as_sfc("POLYGON((500010 6000000,500020 6000000,500020 6000010,500010 6000010,500010 6000000))", crs = 32721)
TARGET <- st_as_sfc("POLYGON((500005 6000000,500015 6000000,500015 6000010,500005 6000010,500005 6000000))", crs = 32721)
DONUT <- st_as_sfc("POLYGON((500000 6000000,500010 6000000,500010 6000010,500000 6000010,500000 6000000),(500002 6000002,500008 6000002,500008 6000008,500002 6000008,500002 6000002))", crs = 32721)
BUF1 <- st_as_sfc("POLYGON((500000 6000000,500006 6000000,500006 6000010,500000 6000010,500000 6000000))", crs = 32721)
BUF2 <- st_as_sfc("POLYGON((500004 6000000,500010 6000000,500010 6000010,500004 6000010,500004 6000000))", crs = 32721)

src <- st_sf(pop = c(100, 50), geometry = st_sfc(A[[1]], B[[1]], crs = 32721))
target <- st_sf(id = "t1", geometry = TARGET)

inter <- st_intersection(st_sf(geometry = A), target)
area_inter <- as.numeric(st_area(inter))
area_source <- as.numeric(st_area(A))

aw_ext <- st_interpolate_aw(src["pop"], target, extensive = TRUE)
aw_int <- st_interpolate_aw(src["pop"], target, extensive = FALSE)

grid <- st_sf(id = "g1", geometry = A)
buffers <- st_sf(id = c("b1", "b2"), geometry = st_sfc(BUF1[[1]], BUF2[[1]], crs = 32721))
dissolved <- st_union(buffers)
exposed <- as.numeric(st_area(st_intersection(grid, dissolved)))
share <- exposed / as.numeric(st_area(grid))
count <- length(st_intersects(grid, buffers)[[1]])

cent <- st_centroid(A)
cent_xy <- st_coordinates(cent)[1, ]

nb <- poly2nb(st_sf(geometry = st_sfc(A[[1]], B[[1]], crs = 32721)), queen = FALSE)
lw <- nb2listw(nb, style = "W", zero.policy = TRUE)
mi <- moran.test(c(1, 3), lw, zero.policy = TRUE)$estimate["Moran I statistic"]
gc <- geary.test(c(1, 3), lw, zero.policy = TRUE)$estimate["Geary C statistic"]
lm <- localmoran(c(1, 3), lw, zero.policy = TRUE)[, "Ii"]

n <- function(x) format(as.numeric(x), digits = 15, scientific = FALSE, trim = TRUE)
arr <- function(xs) paste0("[", paste(vapply(xs, n, character(1)), collapse = ", "), "]")

json <- c(
  "{",
  paste0('  "area": { "square": ', n(st_area(A)), ', "donut": ', n(st_area(DONUT)), ' },'),
  paste0('  "overlap": { "area_intersect": ', n(area_inter), ', "area_source": ', n(area_source), ', "weight": ', n(area_inter / area_source), ' },'),
  paste0('  "areal": { "extensive": ', n(aw_ext$pop[1]), ', "intensive": ', n(aw_int$pop[1]), ' },'),
  paste0('  "exposure": { "share": ', n(share), ', "area": ', n(exposed), ', "count": ', count, ' },'),
  paste0('  "centroid": { "x": ', n(cent_xy[1]), ', "y": ', n(cent_xy[2]), ' },'),
  paste0('  "weights": { "links": 2, "avgNeighbors": 1, "islands": 0, "moranI": ', n(mi), ', "gearyC": ', n(gc), ', "localMoran": ', arr(lm), ' }'),
  "}"
)

writeLines(json, file.path(out_dir, "spatialGapsBenchmarks.json"))
cat("Wrote spatialGapsBenchmarks.json\n")
