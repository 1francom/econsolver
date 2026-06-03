# =============================================================================
# SCRIPT 1: DATA PREPARATION & CLEANING
# =============================================================================
# Propósito: Cargar datos espaciales crudos, unificar sistemas de coordenadas
# y crear variables base corrigiendo sesgos temporales y lógicos.
# =============================================================================
setwd("C:/Franco/Univ/Bachelorarbeit/BA Code")
# ── 1. Librerías y Entorno ───────────────────────────────────────────────────
library(dplyr)
library(sf)
library(writexl)
library(readxl)
library(stringr)
library(tidyr)
library(purrr)
library(tidyverse)
library(lubridate)
library(units)
library(readr)
library(fixest)
library(broom)
library(knitr)

select <- dplyr::select

# Definir el CRS proyectado para Buenos Aires (UTM Zona 21S - EPSG:32721)
# Vital para que las distancias se midan en metros reales y no en grados.
CRS_CABA <- 32721 

# ── 2. Carga de Datos Crudos ─────────────────────────────────────────────────
# (Asegúrate de ajustar tu setwd() o rutas según corresponda)
barrios <- read.csv("barrios.csv")
perimetro_raw   <- read_csv("perimetro.csv")
caba_perimeter  <- st_as_sf(perimetro_raw, wkt = "geometry", crs = 4326)
schools_raw     <- read_excel("schools_with_coordinates.xlsx")
crimes_raw      <- readRDS("delitos_sf_with_grid500.rds")
bus_stops_raw   <- read.csv("paradas-de-colectivo.csv")
police_raw      <- read.csv("comisarias_policia.csv")
police_raw_3 <- read.csv("division_comisaria_vecinal.csv")
ground_use      <- read.csv("relevamiento-usos-del-suelo-2017.csv")   # columns: X, Y, TIPO2_16, PISOS_16, NOMBRE, ...
radio_censal    <- read.csv("informacion-censal-por-radio-2010.csv")


# ── 3. Creación de la Grilla Espacial (El "Canvas") ──────────────────────────
caba <- caba_perimeter %>%
  st_transform(32721)

# Creamos la grilla de 500x500m y la recortamos a la silueta de CABA
grid_500_caba <- st_make_grid(
  caba,
  cellsize = 500,
  square   = TRUE
) %>%
  st_sf() %>%
  mutate(grid_id = row_number()) %>%
  st_intersection(caba) %>%
  mutate(grid_id = row_number())   # reassign after intersection trims border cells

# ── 4. Limpieza de Escuelas (CORRECCIÓN BUG 1) ───────────────────────────────
# SOLUCIÓN: Creamos las variables dummy a nivel de escuela ANTES de colapsar.
schools_clean <- schools_raw %>%
  dplyr:: filter(!is.na(latitude) & !is.na(longitude)) %>%
  # Convertir a objeto espacial asumiendo lat/lon inicial (WGS84)
  st_as_sf(coords = c("longitude", "latitude"), crs = 4326, remove = FALSE) %>%
  st_transform(CRS_CABA) %>%
  mutate(
    # Generamos las dummies aquí, 1 a 1 para cada escuela
    is_private = if_else(sector == "Privado", 1, 0),
    is_public  = if_else(sector == "Estatal", 1, 0)
  )

schools_sf <- schools_clean %>%
  filter(!is.na(latitude), !is.na(longitude)) %>%
  # Remove duplicate coordinate columns introduced by prior geocoding pass
  select(-latitude_nc.y, -longitude_nc.y) %>%
  st_as_sf(coords = c("longitude", "latitude"), crs = 4326) %>%
  st_transform(32721)
# 1. Filtrar primero
schools_sf <- schools_sf %>%
  st_filter(caba, .predicate = st_within)
saveRDS(schools_sf, "schools_sf.rds")
schools_in_grid <- st_join(schools_sf, grid_500_caba %>% select(grid_id), join = st_within)


# Si perdés muchas, usá st_intersects en lugar de st_within
# Aggregate to grid level
schools_grid_count <- schools_in_grid %>%
  st_drop_geometry() %>%
  group_by(grid_id) %>%
  summarise(
    n_schools    = n(),
    n_primario   = sum(is_primario,   na.rm = TRUE),
    n_secundario = sum(is_secundario, na.rm = TRUE),
    n_tecnico    = sum(is_tecnico,    na.rm = TRUE),
    n_pub_schools  = sum(is_public,   na.rm = TRUE),
    n_priv_schools = sum(is_private,  na.rm = TRUE),
    .groups = "drop"
  )

table(schools_clean$sector)
prop.table(table(schools_clean$sector))


# Women share por nivel (Común, total estatal+privado combinado):
# inicial:    49.2%
# primario:   49.6%
# secundario: 48.7%
# técnico:    asumimos secundario = 48.7%
# Ponderamos por matrícula estimada por nivel

schools_grid_count <- schools_grid_count %>%
  mutate(
    students_proxy      = n_pub_schools  * 382 +
      n_priv_schools * 319 +
      n_tecnico      * 351,
    student_density_km2 = students_proxy / 0.25,
    log_student_density = log1p(student_density_km2),
    
    # Students por nivel para ponderar women_share
    students_inicial    = pmax(n_schools - n_primario - n_secundario - n_tecnico, 0) * 
      ((382 + 319) / 2),
    students_primario   = n_primario   * ((382 + 319) / 2),
    students_secundario = n_secundario * ((382 + 319) / 2),
    students_tecnico    = n_tecnico    * 351,
    # Público vs privado separados
    students_pub        = n_pub_schools  * 382,
    students_priv       = n_priv_schools * 319,
    share_priv_students = if_else(students_proxy > 0,
                                  students_priv / students_proxy,
                                  NA_real_),
    
    # Weighted women share
    women_share = if_else(
      students_proxy > 0,
      (students_inicial    * 0.492 +
         students_primario   * 0.496 +
         students_secundario * 0.487 +
         students_tecnico    * 0.487) / students_proxy,
      NA_real_
    )
  )

# Join al panel
panel_500 <- grid_500_caba %>%
  left_join(
    schools_grid_count %>% select(grid_id, students_proxy, student_density_km2,
                                  log_student_density, women_share),
    by = "grid_id"
  ) %>%
  mutate(
    students_proxy      = coalesce(students_proxy,      0),
    student_density_km2 = coalesce(student_density_km2, 0),
    log_student_density = coalesce(log_student_density, 0),
    women_share         = coalesce(women_share,          0)
  )

stopifnot(sum(is.na(panel_500$student_density_km2)) == 0)
stopifnot(sum(is.na(panel_500$women_share))         == 0)
summary(panel_500 %>% select(student_density_km2, women_share) %>% distinct())





saveRDS(schools_grid_count, "schools_and_students.rds")
# ================
# crimes 
crimes_clean <- crimes_raw %>%
  st_transform(32721) %>%
  select(-grid_id) %>% 
  filter(year == 2016) %>% 
  # Le asignamos el grid_id de nuestro mapa actual
  st_join(grid_500_caba %>% select(grid_id), join = st_within) 


# ── 5. Limpieza de Delitos (CORRECCIÓN BUG 2) ────────────────────────────────
# SOLUCIÓN: Aislamiento riguroso de las horas de tratamiento vs control diurno.
SCHOOL_HOURS  <- c(7, 12, 13, 16)
version_2_school_hours <- c(7, 8, 12, 13, 14, 16, 17)
CONTROL_HOURS <- c(6, 8, 9, 10, 11, 14, 15, 17)
version2_control_hours <- c(6, 9, 10, 11, 15, 18)
crimes_clean <- crimes_clean %>%
  st_drop_geometry() %>%
  mutate(
    hora = as.numeric(`Franja Horaria`),
    
    # ── Version 1 (main spec) ──────────────────────────────────────────────
    franja_4cat = case_when(
      hora %in% SCHOOL_HOURS   ~ "school_hour",
      hora %in% CONTROL_HOURS  ~ "control",
      TRUE                     ~ NA_character_
    ),
    school_day_times = case_when(
      hora %in% 7              ~ "start",
      hora %in% CONTROL_HOURS  ~ "control",
      hora %in% 12:13          ~ "exit_primaria",
      hora %in% 16             ~ "exit_secundaria",
      TRUE                     ~ NA_character_
    ),
    school_time = as.integer(franja_4cat == "school_hour" & !is.na(franja_4cat)),
    
    # ── Version 2 (robustness: wider windows) ──────────────────────────────
    franja_v2 = case_when(
      hora %in% version_2_school_hours  ~ "school_hour",
      hora %in% version2_control_hours  ~ "control",
      TRUE                              ~ NA_character_
    ),
    school_day_times_v2 = case_when(
      hora %in% c(7, 8)         ~ "start",
      hora %in% version2_control_hours ~ "control",
      hora %in% c(12, 13)       ~ "exit_primaria",
      hora %in% 16              ~ "exit_secundaria",
      TRUE                      ~ NA_character_
    ),
    school_time_v2 = as.integer(franja_v2 == "school_hour" & !is.na(franja_v2)),
    
    # ── Fecha y calendario ─────────────────────────────────────────────────
    date    = as.Date(Fecha),
    dow     = weekdays(date),
    weekend = as.integer(dow %in% c("Sonntag", "Samstag", "Saturday", "Sunday",
                                    "sábado", "domingo"))
  ) %>%
  # Descartamos noche y madrugada — salvamos el counterfactual
  filter(!is.na(franja_4cat), !month(date) %in% c(1L, 2L))




# Aggregate: one row per grid × date × franja
# Include counts by crime type for heterogeneity analysis
# Excluded from main spec: Homicidios dolosos, Amenazas, Lesiones Dolosas
#   → different mechanism, not related to pedestrian concentration
# Robo automotor kept as separate column but excluded from n_property
#   → opportunistic vehicle crime, not driven by pedestrian targets

crime_panel <- crimes_clean %>%
  group_by(grid_id, date, school_day_times) %>%
  summarise(
    n_crimes     = n(),
    n_robos      = sum(Tipo == "Robo",            na.rm = TRUE),
    n_hurtos     = sum(Tipo == "Hurto",           na.rm = TRUE),
    n_robo_auto  = sum(Tipo == "Robo automotor",  na.rm = TRUE),
    n_hurto_auto = sum(Tipo == "Hurto automotor", na.rm = TRUE),
    n_property   = sum(Tipo %in% c("Robo", "Hurto"), na.rm = TRUE),
    .groups      = "drop"
  )


# ── 6. Limpieza de Controles Espaciales ────────────────────────────────────── ####
# Paradas de colectivo
bus_sf <- bus_stops_raw %>%
  mutate(
    lon = as.numeric(gsub(",", ".", coord_X)),
    lat = as.numeric(gsub(",", ".", coord_Y))
  ) %>%
  filter(!is.na(lon), !is.na(lat)) %>%
  distinct(lon, lat, .keep_all = TRUE) %>%   # one row per unique stop location
  st_as_sf(coords = c("lon", "lat"), crs = 4326) %>%
  st_transform(CRS_CABA)
bus_per_grid <- st_join(
  bus_sf,
  grid_500_caba %>% dplyr::select(grid_id),
  join = st_within
) %>%
  st_drop_geometry() %>%
  group_by(grid_id) %>%
  summarise(n_bus_stops = n(), .groups = "drop")


# Comisarías
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

police_per_grid <- st_join(
  police_sf,
  grid_500_caba %>% dplyr::select(grid_id),
  join = st_within
) %>%
  st_drop_geometry() %>%
  group_by(grid_id) %>%
  summarise(n_police = n(), .groups = "drop")



# SECTION 4: GROUND USE — pct_commercial AND pct_gastronomy PER GRID #####
# =============================================================================
# ground_use columns: X (lon), Y (lat), TIPO2_16 (land use code), SUBRAMA
# TIPO2_16 codes (verify against your data dictionary):
#   "Comercio" or similar prefix → commercial
#   "Gastronomía" / "Alojamiento" → gastronomy / nightlife
# SUBRAMA provides finer detail for gastronomy.
#
# CRITICAL: ground_use records are parcels/points. We aggregate count per grid,
# then divide by total records in grid to get proportions.
# This is a count-based proxy, NOT area-weighted — acceptable given parcel data
# is the finest granularity available. Note this in methods section.

ground_sf <- ground_use %>%
  filter(!is.na(X), !is.na(Y)) %>%
  st_as_sf(coords = c("X", "Y"), crs = 4326) %>%
  st_transform(32721) %>%
  mutate(
    # Adjust regex to match your exact TIPO2_16 category strings
    is_commercial  = as.integer(str_detect(toupper(coalesce(TIPO2_16, "")),
                                           "COMERCIO|COMERCIAL|RETAIL")),
    is_gastronomy  = as.integer(str_detect(toupper(coalesce(TIPO2_16, "")),
                                           "GASTRON|RESTAURANT|BAR|HOTEL|ALOJAMIENTO|ENTRETENIMIENTO"))
  )

ground_in_grid <- st_join(
  ground_sf %>% select(is_commercial, is_gastronomy),
  grid_500_caba %>% select(grid_id),
  join = st_within
)

land_use_per_grid <- ground_in_grid %>%
  st_drop_geometry() %>%
  filter(!is.na(grid_id)) %>%
  group_by(grid_id) %>%
  summarise(
    n_parcels_total = n(),
    n_commercial    = sum(is_commercial, na.rm = TRUE),
    n_gastronomy    = sum(is_gastronomy, na.rm = TRUE),
    .groups = "drop"
  ) %>%
  mutate(
    pct_commercial = n_commercial / n_parcels_total,
    pct_gastronomy = n_gastronomy / n_parcels_total
  )

saveRDS(land_use_per_grid, "land_use_per_grid.rds")


# Grids with no parcels → 0 (no commercial activity recorded)
grid_500_caba <- grid_500_caba %>%
  left_join(land_use_per_grid, by = "grid_id") %>%
  mutate(
    pct_commercial = coalesce(pct_commercial, 0),
    pct_gastronomy = coalesce(pct_gastronomy, 0)
  )



# SECTION 5: CBD DISTANCE — Euclidean from grid centroid to Obelisco
# =============================================================================
# Obelisco coordinates in EPSG:32721 (UTM Zone 21S)
# WGS84: -34.6037 S, -58.3816 W

obelisco_wgs84 <- st_sfc(st_point(c(-58.3816, -34.6037)), crs = 4326)
obelisco_utm   <- st_transform(obelisco_wgs84, 32721)

grid_centroids <- st_centroid(grid_500_caba)

grid_500_caba$dist_cbd <- as.numeric(
  st_distance(grid_centroids, obelisco_utm)[, 1]
)

cat("CBD distance range (m):", range(grid_500_caba$dist_cbd), "\n")



# SECTION 7: SCHOOL BUFFER GEOGRAPHIC VARIABLES #####
# =============================================================================
# (a) Exposure share — area of grid covered by dissolved school buffers
# (b) Buffer count  — number of individual school buffers overlapping grid
# (c) Distance bins — centroid to nearest school

# Ensure school_id exists
schools_sf$school_id <- seq_len(nrow(schools_sf))
grid_500_caba$area_total <- as.numeric(st_area(grid_500_caba))

compute_exposure <- function(schools, grid_sf, radius_m) {
  buf_union    <- st_union(st_buffer(schools, dist = radius_m))
  intersection <- st_intersection(grid_sf["grid_id"], buf_union)
  intersection$area_exposed <- as.numeric(st_area(intersection))
  exposed_tbl  <- intersection %>%
    st_drop_geometry() %>%
    group_by(grid_id) %>%
    summarise(area_exposed = sum(area_exposed), .groups = "drop")
  result <- grid_sf %>%
    st_drop_geometry() %>%
    select(grid_id, area_total) %>%
    left_join(exposed_tbl, by = "grid_id") %>%
    mutate(
      area_exposed = coalesce(area_exposed, 0),
      exposure     = pmin(area_exposed / area_total, 1)
    ) %>%
    select(grid_id, exposure)
  names(result)[2] <- paste0("exposure_", radius_m, "m")
  result
}

compute_buffer_count <- function(schools, grid_sf, radius_m) {
  buf    <- st_buffer(schools, dist = radius_m)
  joined <- st_join(grid_sf["grid_id"], buf["school_id"],
                    join = st_intersects, left = TRUE)
  count_tbl <- joined %>%
    st_drop_geometry() %>%
    group_by(grid_id) %>%
    summarise(n_esc_buf = sum(!is.na(school_id)), .groups = "drop")
  names(count_tbl)[2] <- paste0("n_esc_buffer_", radius_m, "m")
  count_tbl
}

exp_100 <- compute_exposure(schools_sf, grid_500_caba, 100)
exp_200 <- compute_exposure(schools_sf, grid_500_caba, 200)
exp_300 <- compute_exposure(schools_sf, grid_500_caba, 300)

cnt_100 <- compute_buffer_count(schools_sf, grid_500_caba, 100)
cnt_200 <- compute_buffer_count(schools_sf, grid_500_caba, 200)
cnt_300 <- compute_buffer_count(schools_sf, grid_500_caba, 300)

# Distance to nearest school
nearest_idx <- st_nearest_feature(grid_centroids, schools_sf)
grid_centroids$dist_nearest_school <- as.numeric(
  st_distance(grid_centroids, schools_sf[nearest_idx, ], by_element = TRUE)
)

dist_tbl <- grid_centroids %>%
  st_drop_geometry() %>%
  select(grid_id, dist_nearest_school) %>%
  mutate(
    dist_bin = cut(dist_nearest_school,
                   breaks = c(0, 100, 200, 300, Inf),
                   labels = c("0_100", "100_200", "200_300", "300_plus"),
                   right  = FALSE, include.lowest = TRUE)
  )

stopifnot(!any(is.na(dist_tbl$dist_bin)))

# Distance to nearest bus stop
nearest_bus_idx <- st_nearest_feature(grid_centroids, bus_sf)
grid_centroids$dist_nearest_bus <- as.numeric(
  st_distance(grid_centroids, bus_sf[nearest_bus_idx, ], by_element = TRUE)
)

dist_bus_tbl <- grid_centroids %>%
  st_drop_geometry() %>%
  select(grid_id, dist_nearest_bus) %>%
  mutate(
    dist_bus_bin = cut(dist_nearest_bus,
                       breaks = c(0, 100, 200, 300, Inf),
                       labels = c("0_100", "100_200", "200_300", "300_plus"),
                       right  = FALSE, include.lowest = TRUE)
  )

# Distance to nearest police station
nearest_pol_idx <- st_nearest_feature(grid_centroids, police_sf)
grid_centroids$dist_nearest_police <- as.numeric(
  st_distance(grid_centroids, police_sf[nearest_pol_idx, ], by_element = TRUE)
)

dist_police_tbl <- grid_centroids %>%
  st_drop_geometry() %>%
  select(grid_id, dist_nearest_police) %>%
  mutate(
    dist_police_bin = cut(dist_nearest_police,
                          breaks = c(0, 100, 200, 300, Inf),
                          labels = c("0_100", "100_200", "200_300", "300_plus"),
                          right  = FALSE, include.lowest = TRUE)
  )




# SECTION 8: CENSUS — AREAL WEIGHTED INTERPOLATION TO GRID ######
# =============================================================================

radio_censal_sf <- radio_censal %>%
  mutate(geometry = st_as_sfc(WKT, crs = 4326)) %>%
  st_as_sf() %>%
  st_transform(32721) %>%
  mutate(area_radio = as.numeric(st_area(.)))

intersection_census <- st_intersection(
  radio_censal_sf %>% select(ID, TOTAL_POB, T_HOGAR, H_CON_NBI, area_radio),
  grid_500_caba    %>% select(grid_id)
) %>%
  mutate(
    area_intersect = as.numeric(st_area(.)),
    weight         = area_intersect / area_radio
  )

census_per_grid <- intersection_census %>%
  st_drop_geometry() %>%
  group_by(grid_id) %>%
  summarise(
    total_pop  = sum(TOTAL_POB * weight, na.rm = TRUE),
    t_hogar    = sum(T_HOGAR   * weight, na.rm = TRUE),
    h_con_nbi  = sum(H_CON_NBI * weight, na.rm = TRUE),
    .groups = "drop"
  ) %>%
  mutate(
    poverty_rate = ifelse(t_hogar > 0, h_con_nbi / t_hogar, NA_real_)
  )




# =====================================================================
# SECTION 9: COMUNA ASSIGNMENT (for clustered SEs robustness) ########
# =============================================================================
comunas         <- read.csv("comunas.csv", sep = ";")

comunas_sf <- comunas %>%
  mutate(geometry = st_as_sfc(geometry, crs = 4326)) %>%
  st_as_sf() %>%
  st_transform(32721) %>%
  select(comuna)

grid_comuna <- st_join(
  grid_centroids %>% select(grid_id),
  comunas_sf,
  join = st_within
) %>%
  st_drop_geometry()

grid_500_caba <- grid_500_caba %>%
  left_join(grid_comuna, by = "grid_id")


#summary(grid_500_caba)
#summary(land_use_per_grid)
#summary(police_per_grid)
#summary(bus_per_grid)
#summary(schools_grid_count)
#summary(radio_censal_sf)
#summary(grid_centroids)
#summary(grid_comuna)




# ── 7. Guardado de Datasets Limpios ──────────────────────────────────────────
# Exportamos los "bloques de construcción" listos para el Script 2
saveRDS(grid_500_caba,   "clean_grid_500.rds")
saveRDS(schools_grid_count,   "clean_schools.rds")
saveRDS(crimes_clean,    "clean_crimes.rds")
saveRDS(bus_per_grid, "clean_bus_stops.rds")
saveRDS(police_per_grid,    "clean_police.rds")

cat("Script 1 finalizado: Datos espaciales sanitizados y exportados.\n")






# ── 2. Interpolación Ponderada por Área (Radios Censales) ────────────────────
# Proyectamos el censo y calculamos el área original de cada radio
radio_censal_sf <- radio_censal %>%
  mutate(geometry = st_as_sfc(WKT, crs = 4326)) %>%
  st_as_sf() %>%
  st_transform(CRS_CABA) %>%
  mutate(area_radio = as.numeric(st_area(.)))

# Intersecamos los radios con nuestra grilla de 500m
intersection_census <- st_intersection(
  radio_censal_sf %>% select(ID, TOTAL_POB, T_HOGAR, H_CON_NBI, area_radio),
  grid_500_caba %>% select(grid_id)
) %>%
  mutate(
    area_intersect = as.numeric(st_area(.)),
    weight         = area_intersect / area_radio # Ponderador espacial
  )

# Colapsamos a nivel grid_id usando los ponderadores
census_per_grid <- intersection_census %>%
  st_drop_geometry() %>%
  group_by(grid_id) %>%
  summarise(
    total_pop  = sum(TOTAL_POB * weight, na.rm = TRUE),
    t_hogar    = sum(T_HOGAR   * weight, na.rm = TRUE),
    h_con_nbi  = sum(H_CON_NBI * weight, na.rm = TRUE),
    .groups = "drop"
  ) %>%
  # Calculamos la tasa de pobreza al final para evitar promediar tasas (error matemático grave)
  mutate(
    poverty_rate = if_else(t_hogar > 0, h_con_nbi / t_hogar, NA_real_)
  )

saveRDS(census_per_grid, "census_clean.rds")



# =========================================
#   MERGES TO CREATE THE PANEL  #####
# =========================================
grid_enriched <- grid_500_caba %>%
  left_join(census_per_grid,   by = "grid_id") %>%
  left_join(land_use_per_grid, by = "grid_id") %>%
  left_join(schools_grid_count,  by = "grid_id") %>%
  left_join(bus_per_grid,      by = "grid_id") %>%
  left_join(police_per_grid,   by = "grid_id") 
grid_enriched <- grid_enriched %>%
  # Limpieza final: Las grillas sin observaciones reciben un 0 (coalesce)
  mutate(
    across(c(n_schools, n_pub_schools, n_priv_schools, n_bus_stops, n_police), ~ coalesce(.x, 0L)),
    pct_commercial = coalesce(pct_commercial.x, 0),
    pct_gastronomy = coalesce(pct_gastronomy.x, 0),
    comuna = coalesce(comuna, 0),
    n_parcels_total = coalesce(n_parcels_total.x, 0),
    n_commercial = coalesce(n_commercial.x, 0),
    n_gastronomy = coalesce(n_gastronomy.x, 0)
  )     %>%
  select(-pct_commercial.x, -pct_gastronomy.x, -n_parcels_total.x,
         -n_commercial.x, -n_parcels_total.y, -n_commercial.y, -n_gastronomy.x, -n_gastronomy.y)


grid_enriched <- grid_enriched %>%
  # 1. Joins de exposure (Área de buffers)
  left_join(exp_100, by = "grid_id") %>%
  left_join(exp_200, by = "grid_id") %>%
  left_join(exp_300, by = "grid_id") %>%
  left_join(cnt_100, by = "grid_id") %>%
  left_join(cnt_200, by = "grid_id") %>%
  left_join(cnt_300, by = "grid_id") %>%
  # (Si generaste los conteos de buffers cnt_100, cnt_200, cnt_300, sumalos acá también)
  # left_join(cnt_100, by = "grid_id") %>% ...
  
  # 2. Joins de Distancias y Bins
  left_join(dist_tbl, by = "grid_id") %>%
  left_join(dist_bus_tbl, by = "grid_id") %>%
  left_join(dist_police_tbl, by = "grid_id") %>%
  
  # 3. Econometric format: Convertir bins a factores con grupo base correcto
  mutate(
    dist_bin = factor(dist_bin, levels = c("300_plus", "0_100", "100_200", "200_300")),
    dist_bus_bin = factor(dist_bus_bin, levels = c("300_plus", "0_100", "100_200", "200_300")),
    dist_police_bin = factor(dist_police_bin, levels = c("300_plus", "0_100", "100_200", "200_300")),
    n_pub_schools = coalesce(n_pub_schools, 0),
    n_primario = coalesce(n_primario, 0),
    n_priv_schools = coalesce(n_priv_schools, 0),
    n_secundario = coalesce(n_secundario, 0)
  )
saveRDS(grid_enriched, "grid_enriched_500.rds")









# =============================================================================
# SCRIPT 3: CONSTRUCCIÓN DEL PANEL BALANCEADO (907 x 295 x 4) ####
# =============================================================================

# ── 1. Definir Dimensiones del Panel ────────────────────────────────────────
grids      <- grid_enriched$grid_id # Nuestras 907 celdas únicas
dates_2016 <- seq(as.Date("2016-03-01"), as.Date("2016-12-20"), by = "day")
franjas    <- c("start", "exit_primaria", "exit_secundaria", "control")

# ── 4. Crear el Esqueleto Cartesiano (907 x 295 x 4) ─────────────────────────
panel_full <- expand_grid(
  grid_id     = grids,
  date        = dates_2016,
  franja_4cat = franjas
)

# ── 5. Unir Crímenes y Generar los Ceros (Poisson readiness) ─────────────────
crime_panel <- crime_panel %>%
  mutate(year = year(date)) %>%
  filter(year == 2016)

crime_panel_balanced <- panel_full %>%
  left_join(crime_panel, by = c("grid_id", "date", "franja_4cat" = "school_day_times")) %>%
  mutate(
    # Transformamos los NA (ausencia de crimen) en ceros
    across(c(n_crimes, n_robos, n_hurtos, n_property), ~ coalesce(.x, 0L)),
    
    # Variables de calendario base
    dow        = weekdays(date),
    is_weekend = as.integer(dow %in% c("Saturday", "Sunday", "sábado", "domingo")),
    month      = month(date)
  )

# ── 6. EL JOIN FINAL: Inyectar Controles Espaciales ──────────────────────────
# Recordatorio: grid_enriched ya no tiene geometría
crime_panel_final <- crime_panel_balanced %>%
  left_join(grid_enriched, by = "grid_id")

# ── 7. Crear Variables de Tratamiento (School Exposure) ──────────────────────
# Definimos el calendario escolar estricto (eliminando fines de semana)
crime_panel_final <- crime_panel_final %>%
  mutate(
    is_school_time = as.integer(franja_4cat != "control"),
    is_school_day  = as.integer(is_weekend == 0), # Aquí luego restarás feriados/jornadas
    school_exposure = n_schools * is_school_time * is_school_day,
    students_proxy = coalesce(students_proxy, 0),
    student_density_km2 = coalesce(student_density_km2, 0), 
    students_inicial = coalesce(students_inicial, 0),
    students_primario = coalesce(students_primario, 0),
    students_secundario = coalesce(students_secundario, 0), 
    students_tecnico = coalesce(students_tecnico, 0)
  )
n_distinct(crime_panel_final$date)
n_distinct(crime_panel$date)
n_distinct(crime_panel_500_2016$date)
n_distinct(crime_panel_balanced$date)
n_distinct(crime_panel_weekday$date)

colnames(crime_panel)


crime_panel %>%
  filter(school_day_times != "control", n_priv_schools >= 1) %>%
  summarise(m = mean(n_crimes, na.rm = TRUE)) %>%
  pull(m)


# Fuerza bruta: qué combinación de inputs da exactamente 97
# Fijamos lo que sabemos con certeza:
# 357 grids, 1.98 mean_priv, marginal_pct = 1.029%

target <- 97
fixed  <- 357 * 1.98 * 0.01029

# Qué da baseline * days * slots = 97 / fixed?
97 / fixed
# Ese número es baseline * days * slots

# Probá todas las combinaciones razonables
expand.grid(
  days  = c(211, 295, 306),
  slots = c(1, 2, 3, 4)
) %>%
  mutate(
    implied_baseline = target / (fixed * days * slots),
    combo = paste0("days=", days, " slots=", slots)
  ) %>%
  arrange(abs(implied_baseline - 0.044))


357 * 1.98 * 0.01029 * 0.044 * 306 * 1
357 * 1.98 * 0.01029 * 0.042 * 211 * 3
# [1] ~96
357 * 1.98 * 0.01029 * 0.044 * 211
# [1] ?
# ── 8. Verificación de Integridad ────────────────────────────────────────────
stopifnot(nrow(crime_panel_balanced) == nrow(grid_enriched) * 295 * 4)

cat("Panel finalizado con", nrow(crime_panel_final), "filas.\n")
cat("Total de robos en el panel:", sum(crime_panel_final$n_robos), "\n")

saveRDS(crime_panel_final, "crime_panel_final_2016.rds")




# Media de robos por franja en grids proximos (dist_bin != "300m+")
crime_panel_final %>%
  filter(dist_bin != "300_plus") %>%
  group_by(franja_4cat, dist_bin) %>%
  summarise(
    mean_crimes = mean(n_crimes),
    mean_robos  = mean(n_robos),
    mean_hurtos = mean(n_hurtos),
    n_obs       = n(),
    .groups = "drop"
  ) %>%
  print(n = 40)

# Grids proximos únicos por franja
crime_panel_final %>%
  filter(dist_bin != "300m_plus") %>%
  group_by(dist_bin) %>%
  summarise(n_grids = n_distinct(grid_id), .groups = "drop")

# Baseline control hour
crime_panel_final %>%
  filter(franja_4cat == "control") %>%
  summarise(mean_robos = mean(n_robos), mean_crimes = mean(n_crimes))










# Entry 0-100m: 152 grids, -22.0%, baseline start franja, 211 días
baseline_start <- crime_panel_final %>%
  filter(franja_4cat == "start", dist_bin == "0_100") %>%
  summarise(m = mean(n_robos, na.rm = TRUE)) %>%
  pull(m)

cat(baseline_start, "\n")
cat(152 * (-0.220) * baseline_start * 211, "\n")  # debe dar ~-570

# Y dismissal 100-200m (+469):
baseline_exit_prim <- crime_panel_final %>%
  filter(franja_4cat == "exit_primaria", dist_bin == "100_200") %>%
  summarise(m = mean(n_robos, na.rm = TRUE)) %>%
  pull(m)

cat(baseline_exit_prim, "\n")
cat(255 * 0.135 * baseline_exit_prim * 211, "\n")  # debe dar ~+469



baseline_control <- crime_panel_final %>%
  filter(franja_4cat == "control") %>%
  summarise(m = mean(n_robos, na.rm = TRUE)) %>%
  pull(m)

# Entry 0-100m
cat(152 * (-0.220) * baseline_control * 211, "\n")  # target: -570

# Dismissal 100-200m  
cat(255 * 0.135 * baseline_control * 211, "\n")  # target: +469

# Qué baseline implica exactamente cada número?
expand.grid(
  target = c(-570, -958, -607, 233, 469, 313),
  n_grids = c(152, 255, 195),
  pct = c(0.220, 0.218, 0.176, 0.112, 0.135, 0.117),
  days = c(211, 295, 306)
) %>%
  mutate(
    implied_baseline = abs(target) / (n_grids * pct * days)
  ) %>%
  filter(
    (target == -570  & n_grids == 152 & pct == 0.220) |
      (target ==  469  & n_grids == 255 & pct == 0.135) |
      (target == -958  & n_grids == 255 & pct == 0.218) |
      (target ==  233  & n_grids == 152 & pct == 0.112)
  ) %>%
  arrange(abs(implied_baseline - 0.0653))


baseline_control <- 0.0653

tibble(
  effect    = c("entry_0100","entry_100200","entry_200300",
                "dismiss_0100","dismiss_100200","dismiss_200300"),
  n_grids   = c(152, 255, 195, 152, 255, 195),
  pct       = c(-0.220,-0.218,-0.176, 0.112, 0.135, 0.117)
) %>%
  mutate(robberies = round(n_grids * pct * baseline_control * 211))

baseline_all <- crime_panel_final %>%
  summarise(m = mean(n_robos, na.rm = TRUE)) %>%
  pull(m)

cat(152 * (-0.220) * baseline_all * 211, "\n")  # target: -570
cat(255 * (-0.218) * baseline_all * 211, "\n")  # target: -958
cat(195 * (-0.176) * baseline_all * 211, "\n")  # target: -607



# Qué baseline × days implica -2135?
# sum(n_grids × pct) con coefs de la tesis
sum_term <- sum(c(152, 255, 195) * (exp(c(-0.248, -0.246, -0.194)) - 1))
cat(sum_term, "\n")

# Implied baseline × days
(-2135) / sum_term

17.30401 / 211  # = ?
17.30401 / 295  # = ?
17.30401 / 306  # = ?


sum_term_slide <- sum(c(152, 255, 195) * (exp(c(-0.220, -0.218, -0.176)) - 1))
implied <- (-2135) / sum_term_slide
cat(implied, "\n")
cat(implied / 211, "\n")
cat(implied / 295, "\n")
cat(implied / 306, "\n")


tibble(
  n_grids = c(152, 255, 195),
  coef    = c(-0.220, -0.218, -0.176)
) %>%
  mutate(robberies = round(n_grids * (exp(coef)-1) * 0.065 * 295)) %>%
  summarise(total = sum(robberies))



# Senderos: 550-600 fewer robberies 2017
# Tesis: peak ATT = -0.202, 307 grids, 5 bimestres significativos

# Pre-treatment baseline: 2.05 robberies per grid per bimestre (intensity=0)
# Citado explícitamente en la tesis

307 * 0.202 * 5        # ATT × grids × bimestres
307 * (exp(-0.202)-1) * (-1) * 2.05 * 5  # con baseline


#=============================
# GRIDS 300x300 #########
#=============================

grid_300_caba <- st_make_grid(
  caba,
  cellsize = 300,
  square   = TRUE
) %>%
  st_sf() %>%
  mutate(grid_id = row_number()) %>%
  st_intersection(caba) %>%
  mutate(grid_id = row_number())

grid_300_caba$area_total <- as.numeric(st_area(grid_300_caba))
grid_centroids_300 <- st_centroid(grid_300_caba)

#comunas
comunas_sf <- comunas %>%
  mutate(geometry = st_as_sfc(geometry, crs = 4326)) %>%
  st_as_sf() %>%
  st_transform(32721) %>%
  select(comuna)

grid_comuna_300 <- st_join(
  grid_centroids_300 %>% select(grid_id),
  comunas_sf,
  join = st_nearest_feature
) %>%
  st_drop_geometry()


#schools
schools_in_grid_300 <- st_join(
  schools_sf,
  grid_300_caba %>% select(grid_id),
  join = st_within
)
schools_grid_count_300 <- schools_in_grid_300 %>%
  st_drop_geometry() %>%
  group_by(grid_id) %>%
  summarise(
    n_schools    = n(),
    n_primario   = sum(is_primario,   na.rm = TRUE),
    n_secundario = sum(is_secundario, na.rm = TRUE),
    n_tecnico    = sum(is_tecnico,    na.rm = TRUE),
    n_pub_schools  = sum(is_public,   na.rm = TRUE),
    n_priv_schools = sum(is_private,  na.rm = TRUE),
    .groups = "drop"
  )

schools_grid_count_300 <- schools_grid_count_300 %>%
  mutate(
    students_proxy      = n_pub_schools  * 382 +
      n_priv_schools * 319 +
      n_tecnico      * 351,
    student_density_km2 = students_proxy / 0.09,
    log_student_density = log1p(student_density_km2),
    
    students_inicial    = pmax(n_schools - n_primario - n_secundario - n_tecnico, 0) *
      ((382 + 319) / 2),
    students_primario   = n_primario   * ((382 + 319) / 2),
    students_secundario = n_secundario * ((382 + 319) / 2),
    students_tecnico    = n_tecnico    * 351,
    
    women_share = if_else(
      students_proxy > 0,
      (students_inicial    * 0.492 +
         students_primario   * 0.496 +
         students_secundario * 0.487 +
         students_tecnico    * 0.487) / students_proxy,
      NA_real_
    )
  )

panel_300 <- grid_300_caba %>%
  left_join(
    schools_grid_count_300 %>% select(grid_id, students_proxy, student_density_km2,
                                      log_student_density, women_share),
    by = "grid_id"
  ) %>%
  mutate(
    students_proxy      = coalesce(students_proxy,      0),
    student_density_km2 = coalesce(student_density_km2, 0),
    log_student_density = coalesce(log_student_density, 0),
    women_share         = coalesce(women_share,          0)
  )

stopifnot(sum(is.na(panel_300$student_density_km2)) == 0)
stopifnot(sum(is.na(panel_300$women_share))         == 0)


#bus
bus_per_grid_300 <- st_join(bus_sf, grid_300_caba %>% select(grid_id), join = st_within) %>%
  st_drop_geometry() %>%
  group_by(grid_id) %>%
  summarise(n_bus_stops = n(), .groups = "drop")



#police
police_per_grid_300 <- st_join(police_sf, grid_300_caba %>% select(grid_id), join = st_within) %>%
  st_drop_geometry() %>%
  group_by(grid_id) %>%
  summarise(n_police = n(), .groups = "drop")



#land use
ground_in_grid_300 <- st_join(
  ground_sf %>% select(is_commercial, is_gastronomy),
  grid_300_caba %>% select(grid_id),
  join = st_within
)

land_use_per_grid_300 <- ground_in_grid_300 %>%
  st_drop_geometry() %>%
  filter(!is.na(grid_id)) %>%
  group_by(grid_id) %>%
  summarise(
    n_parcels_total = n(),
    n_commercial    = sum(is_commercial, na.rm = TRUE),
    n_gastronomy    = sum(is_gastronomy, na.rm = TRUE),
    .groups = "drop"
  ) %>%
  mutate(
    pct_commercial = n_commercial / n_parcels_total,
    pct_gastronomy = n_gastronomy / n_parcels_total
  )




# aggregate census
intersection_census_300 <- st_intersection(
  radio_censal_sf %>% select(ID, TOTAL_POB, T_HOGAR, H_CON_NBI, area_radio),
  grid_300_caba %>% select(grid_id)
) %>%
  mutate(
    area_intersect = as.numeric(st_area(.)),
    weight         = area_intersect / area_radio
  )

census_per_grid_300 <- intersection_census_300 %>%
  st_drop_geometry() %>%
  group_by(grid_id) %>%
  summarise(
    total_pop  = sum(TOTAL_POB * weight, na.rm = TRUE),
    t_hogar    = sum(T_HOGAR   * weight, na.rm = TRUE),
    h_con_nbi  = sum(H_CON_NBI * weight, na.rm = TRUE),
    .groups = "drop"
  ) %>%
  mutate(poverty_rate = if_else(t_hogar > 0, h_con_nbi / t_hogar, NA_real_))



nearest_idx_300 <- st_nearest_feature(grid_centroids_300, schools_sf)
grid_centroids_300$dist_nearest_school <- as.numeric(
  st_distance(grid_centroids_300, schools_sf[nearest_idx_300, ], by_element = TRUE)
)

dist_tbl_300 <- grid_centroids_300 %>%
  st_drop_geometry() %>%
  select(grid_id, dist_nearest_school) %>%
  mutate(
    dist_bin = cut(dist_nearest_school,
                   breaks = c(0, 100, 200, 300, Inf),
                   labels = c("0_100", "100_200", "200_300", "300_plus"),
                   right = FALSE, include.lowest = TRUE)
  )

exp_100_300 <- compute_exposure(schools_sf, grid_300_caba, 100)
exp_200_300 <- compute_exposure(schools_sf, grid_300_caba, 200)
exp_300_300 <- compute_exposure(schools_sf, grid_300_caba, 300)



cnt_100_300 <- compute_buffer_count(schools_sf, grid_300_caba, 100)
cnt_200_300 <- compute_buffer_count(schools_sf, grid_300_caba, 200)
cnt_300_300 <- compute_buffer_count(schools_sf, grid_300_caba, 300)

nearest_bus_idx_300 <- st_nearest_feature(grid_centroids_300, bus_sf)
grid_centroids_300$dist_nearest_bus <- as.numeric(
  st_distance(grid_centroids_300, bus_sf[nearest_bus_idx_300, ], by_element = TRUE)
)
dist_bus_tbl_300 <- grid_centroids_300 %>%
  st_drop_geometry() %>%
  select(grid_id, dist_nearest_bus) %>%
  mutate(
    dist_bus_bin = cut(dist_nearest_bus,
                       breaks = c(0, 100, 200, 300, Inf),
                       labels = c("0_100", "100_200", "200_300", "300_plus"),
                       right = FALSE, include.lowest = TRUE)
  )

nearest_pol_idx_300 <- st_nearest_feature(grid_centroids_300, police_sf)
grid_centroids_300$dist_nearest_police <- as.numeric(
  st_distance(grid_centroids_300, police_sf[nearest_pol_idx_300, ], by_element = TRUE)
)
dist_police_tbl_300 <- grid_centroids_300 %>%
  st_drop_geometry() %>%
  select(grid_id, dist_nearest_police) %>%
  mutate(
    dist_police_bin = cut(dist_nearest_police,
                          breaks = c(0, 100, 200, 300, Inf),
                          labels = c("0_100", "100_200", "200_300", "300_plus"),
                          right = FALSE, include.lowest = TRUE)
  )


# crimes clean
crimes_clean_300 <- crimes_raw %>%
  st_transform(32721) %>%
  filter(year == 2016) %>%
  st_join(grid_300_caba %>% select(grid_id), join = st_within) %>%
  select(-grid_id.x) %>%
  rename(grid_id = grid_id.y) %>%
  mutate(
    hora = as.numeric(`Franja Horaria`),
    
    # ── Version 1 (main spec) ──────────────────────────────────────────────
    school_day_time = case_when(
      hora %in% SCHOOL_HOURS   ~ "school_hour",
      hora %in% CONTROL_HOURS  ~ "control",
      TRUE                     ~ NA_character_
    ),
    franja_4cat = case_when(
      hora %in% 7              ~ "start",
      hora %in% CONTROL_HOURS  ~ "control",
      hora %in% 12:13          ~ "exit_primaria",
      hora %in% 16             ~ "exit_secundaria",
      TRUE                     ~ NA_character_
    ),
    school_time = as.integer(school_day_time == "school_hour" & !is.na(school_day_time)),
    
    # ── Version 2 (robustness: wider windows) ──────────────────────────────
    franja_v2 = case_when(
      hora %in% version_2_school_hours  ~ "school_hour",
      hora %in% version2_control_hours  ~ "control",
      TRUE                              ~ NA_character_
    ),
    school_day_times_v2 = case_when(
      hora %in% c(7, 8)                ~ "start",
      hora %in% version2_control_hours ~ "control",
      hora %in% c(12, 13)             ~ "exit_primaria",
      hora %in% 16                    ~ "exit_secundaria",
      TRUE                            ~ NA_character_
    ),
    school_time_v2 = as.integer(franja_v2 == "school_hour" & !is.na(franja_v2)),
    
    # ── Fecha y calendario ─────────────────────────────────────────────────
    date    = as.Date(Fecha),
    dow     = weekdays(date),
    weekend = as.integer(dow %in% c("Sonntag", "Samstag", "Saturday", "Sunday",
                                    "sábado", "domingo"))
  ) %>%
  filter(!is.na(school_day_time))

#grid 300 enriched
grid_enriched_300 <- grid_300_caba %>%
  left_join(census_per_grid_300,  by = "grid_id") %>%
  left_join(land_use_per_grid_300, by = "grid_id") %>%
  left_join(schools_grid_count_300, by = "grid_id") %>%
  left_join(bus_per_grid_300,     by = "grid_id") %>%
  left_join(police_per_grid_300,  by = "grid_id") %>%
  left_join(grid_comuna_300,      by = "grid_id") %>%
  left_join(dist_tbl_300,         by = "grid_id") %>%
  left_join(exp_100_300,          by = "grid_id") %>%
  left_join(exp_200_300,          by = "grid_id") %>%
  left_join(exp_300_300,          by = "grid_id") %>%
  st_drop_geometry() %>%
  mutate(
    across(c(n_schools, n_pub_schools, n_priv_schools,
             n_bus_stops, n_police), ~ coalesce(.x, 0L)),
    pct_commercial = coalesce(pct_commercial, 0),
    pct_gastronomy = coalesce(pct_gastronomy, 0),
    poverty_rate   = poverty_rate,
    dist_bin       = factor(dist_bin, levels = c("300_plus", "0_100", "100_200", "200_300"))
  )

grid_enriched_300 <- grid_enriched_300 %>%
  left_join(cnt_100_300, by = "grid_id") %>%
  left_join(cnt_200_300, by = "grid_id") %>%
  left_join(cnt_300_300, by = "grid_id") %>%
  left_join(dist_bus_tbl_300, by = "grid_id") %>%
  left_join(dist_police_tbl_300, by = "grid_id") %>%
  mutate(
    dist_bus_bin    = factor(dist_bus_bin,    levels = c("300_plus", "0_100", "100_200", "200_300")),
    dist_police_bin = factor(dist_police_bin, levels = c("300_plus", "0_100", "100_200", "200_300")),
    students_proxy = coalesce(students_proxy, 0),
    student_density_km2 = coalesce(student_density_km2, 0), 
    students_inicial = coalesce(students_inicial, 0),
    students_primario = coalesce(students_primario, 0),
    students_secundario = coalesce(students_secundario, 0), 
    students_tecnico = coalesce(students_tecnico, 0),
    n_parcelas_total = coalesce(n_parcels_total, 0)
    
  )
saveRDS(grid_enriched_300, "grid_300_caba.rds")

crime_panel_300 <- crimes_clean_300 %>%
  st_drop_geometry() %>%
  mutate(year = year(as.Date(Fecha))) %>%
  filter(!is.na(franja_4cat), year == 2016) %>%
  group_by(grid_id, date, franja_4cat) %>%
  summarise(
    n_crimes  = n(),
    n_robos   = sum(Tipo == "Robo",           na.rm = TRUE),
    n_hurtos  = sum(Tipo == "Hurto",          na.rm = TRUE),
    n_property = sum(Tipo %in% c("Robo", "Hurto"), na.rm = TRUE),
    .groups   = "drop"
  )

panel_full_300 <- expand_grid(
  grid_id     = grid_enriched_300$grid_id,
  date        = dates_2016,
  franja_4cat = franjas
)

crime_panel_balanced_300 <- panel_full_300 %>%
  left_join(crime_panel_300, by = c("grid_id", "date", "franja_4cat")) %>%
  mutate(
    across(c(n_crimes, n_robos, n_hurtos, n_property), ~ coalesce(.x, 0L)),
    dow        = weekdays(date),
    is_weekend = as.integer(dow %in% c("Saturday", "Sunday", "sábado", "domingo")),
    month      = month(date)
  )


stopifnot(all(is.na(crime_panel_balanced_300$grid_id) == FALSE))
stopifnot(nrow(crime_panel_balanced_300) == nrow(grid_enriched_300) * 295 * 4)




# Total robos en el panel
sum(crime_panel_balanced_300$n_robos)# Distribución de n_robos
table(crime_panel_balanced_300$n_robos > 0)

# Robos por franja — debe ser 0 en control y concentrarse en school hours
crime_panel_balanced_300 %>%
  group_by(franja_4cat) %>%
  summarise(total_robos = sum(n_robos), mean_robos = mean(n_robos))

# Cross-check: total robos debe coincidir con crimes_clean_300
sum(crime_panel_300$n_robos, na.rm = TRUE)

crime_panel_final_300 <- crime_panel_balanced_300 %>%
  left_join(st_drop_geometry(grid_enriched_300), by = "grid_id")
crime_panel_final_300 <- crime_panel_final_300 %>%
  mutate(
    across(c(n_parcels_total, n_commercial, n_gastronomy,
             n_schools, n_primario, n_secundario, n_tecnico,
             n_pub_schools, n_priv_schools, n_bus_stops, n_police), 
           ~ coalesce(.x, 0L)),
    pct_commercial = coalesce(pct_commercial, 0),
    pct_gastronomy = coalesce(pct_gastronomy, 0)
  )

# barrios
barrios_sf <- barrios %>%
  mutate(geometry = st_as_sfc(geometry, crs = 4326)) %>%
  st_as_sf() %>%
  st_transform(32721) %>%
  select(id, nombre, comuna)

head(barrios_sf)
# 500x500
grid_barrio_500 <- st_join(
  grid_centroids %>% select(grid_id),
  barrios_sf,
  join = st_nearest_feature
) %>%
  st_drop_geometry() %>%
  rename(barrio = nombre, barrio_id = id)

# 300x300
grid_barrio_300 <- st_join(
  grid_centroids_300 %>% select(grid_id),
  barrios_sf,
  join = st_nearest_feature
) %>%
  st_drop_geometry() %>%
  rename(barrio = nombre, barrio_id = id)

crime_panel_final <- crime_panel_final %>%
  left_join(grid_barrio_500, by = "grid_id")

crime_panel_final_300 <- crime_panel_final_300 %>%
  left_join(grid_barrio_300, by = "grid_id")

DIST_LEVELS <- c("0_100", "100_200", "200_300", "300_plus")

crime_panel_final_300 <- crime_panel_final_300 %>%
  mutate(
    is_school_time    = as.integer(ifelse(franja_4cat == "control", 0, 1)),
    is_weekend        = as.integer(is_weekend),
    n_commercial      = as.integer(n_commercial),
    n_gastronomy      = as.integer(n_gastronomy),
    n_schools         = as.integer(n_schools),
    n_pub_schools     = as.integer(n_pub_schools),
    n_priv_schools    = as.integer(n_priv_schools),
    n_bus_stops       = as.integer(n_bus_stops),
    n_police          = as.integer(n_police),
    n_esc_buffer_100m = as.numeric(coalesce(n_esc_buffer_100m, 0)),
    n_esc_buffer_200m = as.numeric(coalesce(n_esc_buffer_200m, 0)),
    n_esc_buffer_300m = as.numeric(coalesce(n_esc_buffer_300m, 0)),
    exposure_100m     = as.numeric(coalesce(exposure_100m, 0)),
    exposure_200m     = as.numeric(coalesce(exposure_200m, 0)),
    exposure_300m     = as.numeric(coalesce(exposure_300m, 0)),
    women_share         = coalesce(as.numeric(women_share), 0),
    log_student_density = coalesce(as.numeric(log_student_density), 0),
    poverty_rate        = coalesce(as.numeric(poverty_rate), 0),
    i.dist_bin        = as.numeric(factor(as.character(dist_bin),        levels = DIST_LEVELS)),
    i.dist_bus_bin    = as.numeric(factor(as.character(dist_bus_bin),    levels = DIST_LEVELS)),
    i.dist_police_bin = as.numeric(factor(as.character(dist_police_bin), levels = DIST_LEVELS))
  ) %>%
  rename(comuna = comuna.x)%>%
  select(-comuna.y)



saveRDS(crime_panel_final_300, "crime_panel_final_b_300.rds")













# ── V2 subset panel 300: 4 franjas, ventanas ampliadas ────────────────────────

crime_counts_v2_300 <- crimes_clean_300 %>%
  st_drop_geometry() %>%
  filter(!is.na(school_day_times_v2)) %>%
  group_by(grid_id, date, school_day_times_v2) %>%
  summarise(
    n_crimes_v2  = n(),
    n_robos_v2   = sum(Tipo == "Robo",  na.rm = TRUE),
    n_hurtos_v2  = sum(Tipo == "Hurto", na.rm = TRUE),
    .groups = "drop"
  )

panel_full_v2_300 <- expand_grid(
  grid_id            = grid_enriched_300$grid_id,
  date               = dates_2016,
  school_day_times_v2 = c("start", "exit_primaria", "exit_secundaria", "control")
)

crime_panel_v2_300 <- panel_full_v2_300 %>%
  left_join(crime_counts_v2_300, by = c("grid_id", "date", "school_day_times_v2")) %>%
  mutate(
    across(c(n_crimes_v2, n_robos_v2, n_hurtos_v2), ~ coalesce(.x, 0L)),
    is_school_time_v2 = as.integer(school_day_times_v2 != "control"),
    dow        = weekdays(date),
    is_weekend = as.integer(dow %in% c("Saturday", "Sunday", "sábado", "domingo")),
    month      = month(date)
  ) %>%
  left_join(st_drop_geometry(grid_enriched_300), by = "grid_id")

stopifnot(nrow(crime_panel_v2_300) == n_distinct(grid_enriched_300$grid_id) * 295 * 4)

saveRDS(crime_panel_v2_300, "crime_panel_v2_300.rds")
