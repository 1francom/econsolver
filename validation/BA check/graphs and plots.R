

setwd("C:/Franco/Univ/Bachelorarbeit/Hiroshi")  ## <---- Edit path 

# Cargar librerías necesarias por las dudas
library(ggplot2)
library(sf)
library(readxl)
library(tidyverse)


# load data
CRS_CABA <- 32721 
select <- dplyr::select
bus_stops        <- read.csv("paradas-de-colectivo.csv")
police_raw      <- read.csv("comisarias_policia.csv")
police_raw_3 <- read.csv("division_comisaria_vecinal.csv")
schools_2016_sf  <- read_excel("schools_with_coordinates.xlsx")
crimes_sf        <- readRDS("delitos_sf_with_grid500.rds")
barrios <- read.csv("barrios.csv")
comunas <- read.csv("comunas.csv", sep = ";")
senderos <- read.csv("senderos_escolares.csv")
perimetro_raw   <- read_csv("perimetro.csv")
caba_perimeter  <- st_as_sf(perimetro_raw, wkt = "geometry", crs = 4326)
caba  <- st_as_sf(perimetro_raw, wkt = "geometry", crs = 4326)
caba <- caba_perimeter %>%
  st_transform(32721)


grid_300_caba <- st_make_grid(
  caba,
  cellsize = 300,
  square   = TRUE
) %>%
  st_sf() %>%
  mutate(grid_id = row_number()) %>%
  st_intersection(caba) %>%
  mutate(grid_id = row_number())

bus_sf <- bus_stops %>%
  mutate(
    lon = as.numeric(gsub(",", ".", coord_X)),
    lat = as.numeric(gsub(",", ".", coord_Y))
  ) %>%
  filter(!is.na(lon), !is.na(lat)) %>%
  distinct(lon, lat, .keep_all = TRUE) %>%   # one row per unique stop location
  st_as_sf(coords = c("lon", "lat"), crs = 4326) %>%
  st_transform(CRS_CABA)

# Generar el mapa
mapa_grilla_300 <- ggplot() +
  # 1. Capa base: El perímetro de CABA (gris claro para dar contexto)
  geom_sf(data = caba, 
          fill = "grey95", 
          color = "black", 
          linewidth = 0.5) +
  
  # 2. Capa superior: La grilla de 300x300 
  geom_sf(data = grid_300_caba, 
          fill = NA,                # Transparente 
          color = "#d73027",        # Red para 
          linewidth = 0.1,          
          alpha = 0.7) +
  
  # 3. Estética y etiquetas
  theme_minimal() +
  labs(
    title = "Spatial resolution CABA: 300x300 grid",
    subtitle = "Ciudad Autónoma de Buenos Aires",
    x = "Longitud",
    y = "Latitud"
  ) +
  theme(
    plot.title = element_text(face = "bold", size = 14),
    plot.subtitle = element_text(color = "grey40", size = 11),
    panel.grid.major = element_line(color = "grey90", linetype = "dashed")
  )

# Mostrar el gráfico en RStudio
print(mapa_grilla_300)

# (Opcional) Guardarlo en alta resolución para la tesis
# ggsave("mapa_grilla_300m.png", plot = mapa_grilla_300, width = 10, height = 8, dpi = 300)


caba_perimeter  <- st_as_sf(perimetro_raw, wkt = "geometry", crs = 4326)
barrios <- read.csv("barrios.csv")
comunas <- read.csv("comunas.csv", sep = ";")
senderos <- read.csv("senderos_escolares.csv")
# ============================================================
# 2. BUILD GRID
# ============================================================

caba <- caba_perimeter %>%
  st_transform(32721)

grid_500_caba <- st_make_grid(
  caba,
  cellsize = 500,
  square   = TRUE
) %>%
  st_sf() %>%
  mutate(grid_id = row_number()) %>%
  st_intersection(caba) %>%
  mutate(grid_id = row_number())   # reassign after intersection trims border cells

# ── Plot 1: grid over CABA perimeter ───────────────────────
ggplot() +
  geom_sf(data = caba, fill = "grey90", color = "black", size = 0.4) +
  geom_sf(data = grid_500_caba, fill = NA, color = "red", size = 0.2) +
  theme_minimal() +
  labs(title = "500m Grids Restricted to CABA Perimeter")

# ── Plot 2: clipped cells ───────────────────────────────────
ggplot() +
  geom_sf(data = grid_500_caba, fill = "red", alpha = 0.2, color = "red", size = 0.1) +
  geom_sf(data = caba, fill = NA, color = "black", size = 0.6) +
  theme_minimal() +
  labs(title = "Grid Cells Clipped to CABA Boundary")




# 3. SCHOOLS → COUNT PER GRID
# ============================================================

schools_2016_sf <- schools_2016_sf %>%
  dplyr:: filter(!is.na(latitude) & !is.na(longitude)) %>%
  dplyr::select(-longitude_nc.y, -latitude_nc.y) %>%
  st_as_sf(coords = c("longitude", "latitude"), crs = 4326) %>%
  st_transform(32721)

# Assign grid_id to each school
schools_2016_proj <- st_join(
  schools_2016_sf,
  grid_500_caba,
  join = st_within
)

# ── Plot 3: schools colored by grid assignment ──────────────
ggplot() +
  geom_sf(data = grid_500_caba, fill = NA, color = "grey80", size = 0.2) +
  geom_sf(data = schools_2016_proj,
          aes(color = is.na(grid_id)), size = 1) +
  scale_color_manual(values = c("FALSE" = "blue", "TRUE" = "red")) +
  theme_minimal() +
  labs(color = "No Grid ID")

# Count schools per grid by type
schools_grid_count <- schools_2016_proj %>%
  st_drop_geometry() %>%
  group_by(grid_id) %>%
  summarise(
    n_schools    = n(),
    n_primario   = sum(is_primario,   na.rm = TRUE),
    n_secundario = sum(is_secundario, na.rm = TRUE),
    n_tecnico    = sum(is_tecnico,    na.rm = TRUE),
    is_private = ifelse(sector == "Privado", 1, 0),
    is_public = ifelse(sector == "Estatal", 1, 0),
    n_private = sum(is_private, na..rm = TRUE),
    n_public = sum(is_public, na.rm = TRUE),
    .groups = "drop"
  )

# Join school counts to grid — grids with no schools get 0
grid_500_caba <- grid_500_caba %>%
  left_join(schools_grid_count, by = "grid_id") %>%
  mutate(
    n_schools    = coalesce(n_schools,    0L),
    n_primario   = coalesce(n_primario,   0L),
    n_secundario = coalesce(n_secundario, 0L),
    n_tecnico    = coalesce(n_tecnico,    0L)
  )

# ── Plot 4: school density per grid ────────────────────────
ggplot(grid_500_caba) +
  geom_sf(aes(fill = n_schools), color = NA) +
  scale_fill_viridis_c() +
  theme_minimal() +
  labs(title = "Number of Schools per 500m Grid Cell")

















police_sf_1 <- police_raw %>%
  st_as_sf(wkt = "geometry", crs = 4326) %>%
  st_transform(32721) %>%
  select(geometry)

police_sf_3 <- police_raw_3 %>%
  mutate(geometry = st_as_sfc(geometry, crs = 4326)) %>%
  st_as_sf() %>%
  st_transform(32721) %>%
  st_centroid() %>%
  select(geometry)

police_sf <- bind_rows(police_sf_1, police_sf_3) %>%
  mutate(police_id = row_number())



# =============================================================================
# BUFFER MAPS — schools, bus stops, police stations
# =============================================================================

# --- función genérica ---
plot_buffers <- function(facilities_sf, grid_sf, caba_sf, 
                         radius_m, title, point_color = "red") {
  buffers <- st_buffer(facilities_sf, dist = radius_m) %>%
    st_transform(4326)
  
  facilities_wgs <- facilities_sf %>% st_transform(4326)
  grid_wgs       <- grid_sf      %>% st_transform(4326)
  caba_wgs       <- caba_sf      %>% st_transform(4326)
  
  ggplot() +
    geom_sf(data = grid_wgs,       fill = NA, color = "grey80", linewidth = 0.1) +
    geom_sf(data = caba_wgs,       fill = NA, color = "grey40", linewidth = 0.4) +
    geom_sf(data = buffers,        fill = "#6baed6", color = NA, alpha = 0.3) +
    geom_sf(data = facilities_wgs, color = point_color, size = 0.6, alpha = 0.8) +
    labs(title = title) +
    theme_minimal(base_size = 11) +
    theme(
      plot.title      = element_text(face = "bold", hjust = 0.5),
      axis.text       = element_text(size = 7),
      panel.grid.major = element_line(color = "grey90")
    )
}

# --- schools 200m ---
p_map_schools <- plot_buffers(
  schools_2016_sf, grid_500_caba, caba,
  radius_m = 200,
  title    = "School Buffers (200m)"
)# --- bus stops 200m ---
p_map_bus <- plot_buffers(
  bus_sf, grid_500_caba, caba,
  radius_m    = 200,
  title       = "Bus Stop Buffers (200m)",
  point_color = "#d95f02"
)

# --- police stations 200m ---
p_map_police <- plot_buffers(
  police_sf, grid_500_caba, caba,
  radius_m    = 200,
  title       = "Police Station Buffers (200m)",
  point_color = "#1b7837"
)


print(p_map_schools)
print(p_map_bus)
print(p_map_police)


ggsave("plots/map_school_buffers.pdf",  p_map_schools, width = 7, height = 8)
ggsave("plots/map_bus_buffers.pdf",     p_map_bus,     width = 7, height = 8)
ggsave("plots/map_police_buffers.pdf",  p_map_police,  width = 7, height = 8)
ggsave("plots/map_buffer_panel.pdf",    p_map_panel,   width = 18, height = 7)
ggsave("plots/map_buffer_panel.png",    p_map_panel,   width = 18, height = 7, dpi = 150)

library(ggplot2)
library(fixest)
library(dplyr)

# Extraer coeficientes de z_dist1
coefs <- coeftable(z_dist1) %>%
  as.data.frame() %>%
  tibble::rownames_to_column("term") %>%
  rename(estimate = Estimate, se = `Std. Error`) %>%
  filter(grepl("dist_bin", term)) %>%
  mutate(
    franja = case_when(
      grepl("exit_primaria",   term) ~ "Exit primaria",
      grepl("exit_secundaria", term) ~ "Exit secundaria",
      grepl("start",           term) ~ "School start"
    ),
    bin = case_when(
      grepl("0_100",   term) ~ "0–100m",
      grepl("100_200", term) ~ "100–200m",
      grepl("200_300", term) ~ "200–300m"
    ),
    bin = factor(bin, levels = c("0–100m", "100–200m", "200–300m")),
    franja = factor(franja, levels = c("School start", "Exit primaria", "Exit secundaria")),
    ci_lo = estimate - 1.96 * se,
    ci_hi = estimate + 1.96 * se,
    pct        = (exp(estimate) - 1) * 100,
    pct_ci_lo  = (exp(ci_lo) - 1) * 100,
    pct_ci_hi  = (exp(ci_hi) - 1) * 100
  )

ggplot(coefs, aes(x = bin, y = pct, color = franja, group = franja)) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "grey50", linewidth = 0.4) +
  geom_line(linewidth = 0.7, position = position_dodge(width = 0.15)) +
  geom_pointrange(
    aes(ymin = pct_ci_lo, ymax = pct_ci_hi),
    size = 0.5, linewidth = 0.8,
    position = position_dodge(width = 0.15)
  ) +
  scale_color_manual(
    values = c("School start"     = "#c0392b",
               "Exit primaria"    = "#2980b9",
               "Exit secundaria"  = "#27ae60"),
    name = NULL
  ) +
  scale_y_continuous(
    labels = function(x) paste0(x, "%"),
    breaks = seq(-30, 20, by = 10)
  ) +
  labs(
    title    = "Spatial gradient of school-hour crime effects",
    subtitle = "TWFE Poisson | grid + day FE | 2016 | Reference: control hours & 300m+",
    x        = "Distance to nearest school",
    y        = "% change in crime vs. reference",
    caption  = "95% CI | Clustered SE at grid level | N = 1,174,128"
  ) +
  theme_minimal(base_size = 11) +
  theme(
    legend.position   = "bottom",
    panel.grid.minor  = element_blank(),
    panel.grid.major.x = element_blank(),
    plot.title        = element_text(face = "bold", size = 12),
    plot.subtitle     = element_text(color = "grey40", size = 9),
    plot.caption      = element_text(color = "grey50", size = 8)
  )

ggsave("spatial_gradient_dist1_upgraded.pdf", width = 7, height = 4.5, dpi = 300)






library(fixest)
library(ggplot2)
library(patchwork)

# ── TABLA 1: Baseline n_crimes ──────────────────────────────────────────────
etable(
  m_A1, m_a2, m_A7,
  keep   = c("is_school_time", "n_schools", "n_bus_stops",
             "n_police", "n_commercial", "poverty_rate"),
  digits = 3,
  depvar = FALSE,
  tex    = TRUE,
  style.tex = style.tex("base"),
  title  = "School Density and Crime: Baseline Specifications",
  label  = "tab:baseline",
  file   = "table1_baseline.tex"
)

# ── TABLA 2: Sector + poverty ────────────────────────────────────────────────
etable(
  m_A4, m_A8,
  keep   = c("is_school_time", "n_pub_schools", "n_priv_schools",
             "n_bus_stops", "n_police", "n_commercial", "poverty_rate"),
  digits = 3,
  depvar = FALSE,
  tex    = TRUE,
  style.tex = style.tex("base"),
  title  = "Heterogeneity by School Sector and Poverty",
  label  = "tab:sector",
  file   = "table2_sector.tex"
)

# ── TABLA 3: Spatial gradient (z_dist1, z_dist2) ────────────────────────────
etable(
  z_dist1, z_dist2,
  keep   = "dist_bin",
  digits = 3,
  depvar = FALSE,
  tex    = TRUE,
  style.tex = style.tex("base"),
  title  = "Spatial Gradient of School-Hour Crime Effects",
  label  = "tab:gradient",
  file   = "table3_gradient.tex"
)

# ── FIGURA 1: Spatial gradient plot (p_dist1 solo, limpio) ──────────────────
p_gradient_final <- ggplot(df1, aes(x = bin, y = pct, color = franja, group = franja)) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "grey50", linewidth = 0.4) +
  geom_line(linewidth = 0.7, position = position_dodge(width = 0.15)) +
  geom_pointrange(
    aes(ymin = pct_lo, ymax = pct_hi),
    size = 0.5, linewidth = 0.8,
    position = position_dodge(width = 0.15)
  ) +
  scale_color_manual(
    values = c("Exit primaria"   = "#2c7bb6",
               "Exit secundaria" = "#1a9641",
               "Start"           = "#d7191c"),
    name = NULL
  ) +
  scale_x_discrete(labels = c("0–100m", "100–200m", "200–300m")) +
  scale_y_continuous(labels = function(x) paste0(x, "%")) +
  labs(
    x       = "Distance to nearest school",
    y       = "% change in crime vs. reference\n(control hours, 300m+)",
    caption = "TWFE Poisson | grid + day FE | 2016 | 95% CI | Clustered SE at grid level"
  ) +
  theme_minimal(base_size = 11) +
  theme(
    legend.position    = "bottom",
    panel.grid.minor   = element_blank(),
    panel.grid.major.x = element_blank(),
    plot.caption       = element_text(color = "grey50", size = 8)
  )

ggsave("fig1_spatial_gradient.pdf", p_gradient_final,
       width = 6, height = 4, dpi = 300)
ggsave("fig1_spatial_gradient.png", p_gradient_final,
       width = 6, height = 4, dpi = 300)



# ── Load spatial objects ──────────────────────────────────────────────────────
grid_sf <- readRDS("grid_enriched_500.rds") %>% st_as_sf() %>% st_transform(32721)

barrios_sf <- read.csv("barrios.csv") %>%
  mutate(geometry = st_as_sfc(geometry, crs = 4326)) %>%
  st_as_sf() %>%
  st_transform(32721) %>%
  select(nombre, comuna)

comunas_sf <- read.csv("comunas.csv", sep = ";") %>%
  mutate(geometry = st_as_sfc(geometry, crs = 4326)) %>%
  st_as_sf() %>%
  st_transform(32721) %>%
  select(comuna)

# ── Join dist_bin to grid ─────────────────────────────────────────────────────
dist_bins <- crime_panel_final %>%
  distinct(grid_id, dist_bin)

grid_plot <- grid_sf %>%
  select(-dist_bin) %>%
  left_join(dist_bins, by = "grid_id") %>%
  mutate(dist_bin = factor(dist_bin,
                           levels = c("0_100","100_200","200_300","300_plus"),
                           labels = c("0–100 m","100–200 m","200–300 m","300+ m")))

# ── Barrio label centroids ────────────────────────────────────────────────────
barrio_centroids <- barrios_sf %>%
  st_centroid() %>%
  mutate(
    x = st_coordinates(.)[,1],
    y = st_coordinates(.)[,2]
  ) %>%
  st_drop_geometry()

# ── Plot ──────────────────────────────────────────────────────────────────────
ggplot() +
  # Grid cells coloured by distance bin
  geom_sf(data = grid_plot,
          aes(fill = dist_bin),
          color = NA, alpha = 0.85) +
  scale_fill_manual(
    values = c("0–100 m"   = "#d7191c",
               "100–200 m" = "#fdae61",
               "200–300 m" = "#abd9e9",
               "300+ m"    = "#2c7bb6"),
    name = "Distance to\nnearest school",
    na.value = "grey80"
  ) +
  # Barrio boundaries
  geom_sf(data = barrios_sf,
          fill = NA, color = "white", linewidth = 0.25) +
  # Comuna boundaries (thicker)
  geom_sf(data = comunas_sf,
          fill = NA, color = "grey20", linewidth = 0.6) +
  # Barrio labels
  geom_text(data = barrio_centroids,
            aes(x = x, y = y, label = nombre),
            size = 1.6, color = "grey10", fontface = "plain",
            check_overlap = TRUE) +
  labs(
    title    = "Distance to Nearest School by Grid Cell, CABA",
    subtitle = "500 × 500 m grid | Barrio and comuna boundaries overlaid",
    caption  = "Source: Establecimientos Educativos, Buenos Aires Data. Grid: authors' construction."
  ) +
  theme_void(base_size = 10) +
  theme(
    plot.title    = element_text(face = "bold", size = 11, hjust = 0),
    plot.subtitle = element_text(size = 8, color = "grey40", hjust = 0),
    plot.caption  = element_text(size = 7, color = "grey50"),
    legend.position   = "right",
    legend.title      = element_text(size = 8, face = "bold"),
    legend.text       = element_text(size = 7),
    plot.margin       = margin(10, 10, 10, 10)
  )

ggsave("fig_grid_dist_bin.png", width = 8, height = 7, dpi = 300)
