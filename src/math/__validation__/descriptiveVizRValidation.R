# Descriptive visualization validation fixtures.
#
# Run from project root:
#   Rscript src/math/__validation__/descriptiveVizRValidation.R
#
# Requires: sf, KernSmooth, jsonlite
# Outputs:
#   src/math/__validation__/descriptiveVizBenchmarks.json

library(sf)
library(KernSmooth)
library(jsonlite)

out_dir <- file.path("src", "math", "__validation__")

pts <- data.frame(
  lon = c(-58.4, -58.401, -58.399),
  lat = c(-34.6, -34.601, -34.602)
)

sf_pts <- st_as_sf(pts, coords = c("lon", "lat"), crs = 4326)
xy <- st_coordinates(st_transform(sf_pts, 32721))

bandwidth <- 500
x_grid <- seq(min(xy[, 1]), max(xy[, 1]), length.out = 3)
y_grid <- seq(min(xy[, 2]), max(xy[, 2]), length.out = 3)

k <- bkde2D(
  xy,
  bandwidth = c(bandwidth, bandwidth),
  gridsize = c(3, 3),
  range.x = list(range(x_grid), range(y_grid))
)

# Keep row order aligned with the JS raster rows: y index outer, x index inner.
dens <- as.vector(t(k$fhat))
coords_metric <- do.call(rbind, lapply(y_grid, function(y) cbind(x_grid, y)))
coords_ll <- st_coordinates(st_transform(st_as_sf(data.frame(x = coords_metric[, 1], y = coords_metric[, 2]), coords = c("x", "y"), crs = 32721), 4326))

bench <- list(
  kde2d = list(
    bandwidth = bandwidth,
    densities = as.numeric(dens),
    coords = lapply(seq_len(nrow(coords_ll)), function(i) c(round(coords_ll[i, 1], 6), round(coords_ll[i, 2], 6)))
  ),
  colorScale = list(
    numeric = list(type = "numeric-discrete", values = c(1, 2, 3)),
    categorical = list(type = "categorical", cats = c("north", "south"))
  )
)

write_json(bench, file.path(out_dir, "descriptiveVizBenchmarks.json"), pretty = TRUE, digits = 12, auto_unbox = TRUE)
cat("Wrote descriptiveVizBenchmarks.json\n")
