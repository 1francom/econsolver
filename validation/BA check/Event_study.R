# =============================================================================
# SCRIPT 05: SUN-ABRAHAM EVENT STUDY — SENDEROS ESCOLARES
# =============================================================================
# Unit      : grid_id x bimestre x slot
# Treatment : Senderos id <= 207 (Fase Original, Mar 2017)
# Control   : Fase 2 expansion (not-yet-treated), never-treated EXCLUDED
# Estimator : Sun-Abraham (sunab) via fepois — corrects TWFE heterogeneity bias
# Reference : bim_idx = 6 (Nov-Dic 2016) — last clean pre-treatment bimestre
# Sample    : 2016-03-01 to 2019-12-31 (Jan-Feb excluded: school holidays)
# Slots     : control | school_only | double_only | school_double
# Intensity : 0 = HOURS_AGENTS, 1 = HOURS_DOUBLE (agents + police)
# =============================================================================
setwd("C:/Franco/Univ/Bachelorarbeit/BA Code")  ## <---- Edit path 

library(dplyr)
library(sf)
library(lubridate)
library(tidyr)
library(fixest)
library(ggplot2)



select   <- dplyr::select
CRS_CABA <- 32721

# =============================================================================
# SECTION 1: LOAD INPUTS
# =============================================================================

crimes_raw   <- readRDS("delitos_sf_with_grid500.rds")
senderos_raw <- read.csv("senderos_full.csv")
grid_500     <- readRDS("grid_enriched_500.rds") %>% st_as_sf()
barrios <- read.csv("barrios.csv")
barrios_sf <- barrios %>%
  mutate(geometry = st_as_sfc(geometry, crs = 4326)) %>%
  st_as_sf() %>%
  st_transform(32721) %>%
  select(id, nombre, comuna)
comunas         <- read.csv("comunas.csv", sep = ";")
comunas_sf <- comunas %>%
  mutate(geometry = st_as_sfc(geometry, crs = 4326)) %>%
  st_as_sf() %>%
  st_transform(32721) %>%
  select(comuna)


# comunas_sf and barrios_sf must be in environment before running

stopifnot(inherits(grid_500, "sf"))
stopifnot(all(c("grid_id", "n_bus_stops", "n_police",
                "poverty_rate", "n_schools",
                "n_pub_schools", "n_priv_schools",
                "student_density_km2", "share_priv_students",
                "women_share", "pct_commercial",
                "pct_gastronomy") %in% colnames(grid_500)))

# =============================================================================
# SECTION 2: GLOBAL CONSTANTS — defined early to avoid forward-reference errors
# =============================================================================

DOSE_THRESHOLD <- 200L  # meters — minimum sendero length to qualify as treated
REF_BIM        <- 6L    # Nov-Dic 2016 — last clean pre-treatment bimestre
COHORT_FASE1   <- 8L    # Mar-Apr 2017 — first operational bimestre Fase Original
COHORT_FASE2   <- 29L   # Jul-Aug 2020 — outside sample, used as not-yet-treated

SLOT_MAP <- tribble(
  ~hora_num, ~slot,
  6L,  "control",
  9L,  "control",
  10L, "control",
  11L, "control",
  14L, "control",
  15L, "control",
  12L, "school_only",
  16L, "school_only",
  13L, "double_only",
  18L, "double_only",
  19L, "double_only",
  7L,  "school_double",
  8L,  "school_double",
  17L, "school_double"
)

SLOT_LEVELS <- c("control", "school_only", "double_only", "school_double")

SLOT_INDICATORS <- tibble(
  slot           = SLOT_LEVELS,
  intensity_num  = c(0, 0, 1, 1),
  is_school_time = c(0, 1, 0, 1)
)

stopifnot(nrow(SLOT_MAP) == 14L)
stopifnot(!anyDuplicated(SLOT_MAP$hora_num))

HOURS_AGENTS <- c(6L, 9L, 10L, 11L, 12L, 14L, 15L, 16L)
HOURS_DOUBLE <- c(7L, 8L, 13L, 17L, 18L, 19L)
ALL_HOURS    <- c(HOURS_AGENTS, HOURS_DOUBLE)
DOW_WEEKDAY  <- 2:6
DOW_WEEKEND  <- c(1L, 7L)

# =============================================================================
# SECTION 3: SENDERO SPATIAL OBJECTS
# =============================================================================

# 3A. 150m buffer for binary treatment assignment
senderos_original <- senderos_raw %>%
  filter(id <= 207) %>%
  distinct(id, .keep_all = TRUE) %>%
  st_as_sf(wkt = "geometry", crs = 4326) %>%
  st_transform(CRS_CABA) %>%
  st_buffer(dist = 150) %>%
  select(id)

# 3B. Lines (no buffer) for length and dose calculation
senderos_lines_207 <- senderos_raw %>%
  filter(id <= 207) %>%
  distinct(id, .keep_all = TRUE) %>%
  st_as_sf(wkt = "geometry", crs = 4326) %>%
  st_transform(CRS_CABA) %>%
  select(id)

cat(sprintf("Sendero geometry type: %s\n",
            paste(unique(st_geometry_type(senderos_lines_207)), collapse = ", ")))

# =============================================================================
# SECTION 4: GRID-LEVEL TREATMENT VARIABLES
# =============================================================================

# 4A. Binary treatment (intersects 150m buffer)
grid_treatment <- grid_500 %>%
  st_join(senderos_original, join = st_intersects) %>%
  st_drop_geometry() %>%
  group_by(grid_id) %>%
  summarise(treated = as.integer(any(!is.na(id))), .groups = "drop")

cat(sprintf("Treated: %d | Control: %d\n",
            sum(grid_treatment$treated), sum(!grid_treatment$treated)))

# 4B. Sendero length per grid (Fase Original)
sendero_length_raw <- st_intersection(
  grid_500 %>% select(grid_id),
  senderos_lines_207
) %>%
  st_collection_extract("LINESTRING") %>%
  mutate(length_m = as.numeric(st_length(.))) %>%
  filter(length_m > 0) %>%
  st_drop_geometry()

# 4C. Agent dose per grid
agentes_2017        <- round(760 * (209 / 309))   # = 515
agentes_por_sendero <- agentes_2017 / 209

total_length_207 <- senderos_lines_207 %>%
  mutate(length_m = as.numeric(st_length(.))) %>%
  st_drop_geometry() %>%
  summarise(total = sum(length_m)) %>%
  pull(total)

cat(sprintf("Total network length: %.0fm | Agents/meter: %.4f\n",
            total_length_207, agentes_2017 / total_length_207))

sendero_agentes <- senderos_lines_207 %>%
  mutate(length_m = as.numeric(st_length(.))) %>%
  st_drop_geometry() %>%
  mutate(agentes_sendero = agentes_por_sendero * (length_m / mean(length_m))) %>%
  select(id, length_m_sendero = length_m, agentes_sendero)

sendero_dose <- sendero_length_raw %>%
  left_join(sendero_agentes, by = "id") %>%
  mutate(
    frac_in_grid    = length_m / length_m_sendero,
    agentes_en_grid = frac_in_grid * agentes_sendero
  ) %>%
  group_by(grid_id) %>%
  summarise(
    sendero_length_m  = sum(length_m),
    agentes_asignados = sum(agentes_en_grid),
    .groups = "drop"
  ) %>%
  mutate(
    log_sendero_length = log1p(sendero_length_m),
    log_agentes        = log1p(agentes_asignados)
  )

cat(sprintf("Grids with sendero: %d | Max agents: %.1f | Mean agents: %.1f\n",
            nrow(sendero_dose),
            max(sendero_dose$agentes_asignados),
            mean(sendero_dose$agentes_asignados)))

# 4D. pct_covered: share of grid area inside 150m buffer
grid_area <- grid_500 %>%
  mutate(total_area = as.numeric(st_area(.))) %>%
  st_drop_geometry() %>%
  select(grid_id, total_area)

covered_area <- st_intersection(
  grid_500 %>% select(grid_id),
  senderos_original %>% st_union() %>% st_sf()
) %>%
  mutate(intersect_area = as.numeric(st_area(.))) %>%
  st_drop_geometry() %>%
  group_by(grid_id) %>%
  summarise(covered_area = sum(intersect_area), .groups = "drop")

geo_vars_500 <- grid_area %>%
  left_join(covered_area, by = "grid_id") %>%
  mutate(
    covered_area = coalesce(covered_area, 0),
    pct_covered  = covered_area / total_area
  ) %>%
  select(grid_id, total_area, pct_covered)

# 4E. Spillover zones: adjacency to treated grids
treated_sf <- grid_500 %>%
  inner_join(grid_treatment %>% filter(treated == 1L), by = "grid_id")

control_sf <- grid_500 %>%
  inner_join(grid_treatment %>% filter(treated == 0L), by = "grid_id")

adjacent_ids <- control_sf %>%
  st_filter(treated_sf, .predicate = st_touches) %>%
  pull(grid_id)

grid_zones <- grid_500 %>%
  st_drop_geometry() %>%
  select(grid_id) %>%
  left_join(grid_treatment, by = "grid_id") %>%
  mutate(
    zone         = case_when(
      treated == 1L             ~ "treated",
      grid_id %in% adjacent_ids ~ "spillover",
      TRUE                       ~ "control"
    ),
    zone         = factor(zone, levels = c("control", "spillover", "treated")),
    is_spillover = as.integer(zone == "spillover")
  )

stopifnot(nrow(grid_zones) == nrow(grid_500))
stopifnot(sum(grid_zones$treated == 1L & grid_zones$zone == "spillover") == 0)
cat("Zone distribution:\n"); print(table(grid_zones$zone))

# 4F. Residual sendero exposure (net of school density)
dose_full <- grid_500 %>%
  st_drop_geometry() %>%
  select(grid_id, n_schools) %>%
  left_join(sendero_dose %>% select(grid_id, sendero_length_m), by = "grid_id") %>%
  mutate(
    sendero_length_m = coalesce(sendero_length_m, 0),
    n_schools        = coalesce(n_schools, 0)
  )

m_resid <- lm(sendero_length_m ~ n_schools, data = dose_full)
dose_full$resid_sendero_exposure <- residuals(m_resid)
cat(sprintf("Residual exposure R2: %.3f\n", summary(m_resid)$r.squared))

# 4G. Comuna and barrio assignment
grid_centroids_500 <- grid_500 %>% st_centroid() %>% select(grid_id)

grid_comuna_barrio <- st_join(
  grid_centroids_500,
  comunas_sf %>% select(comuna),
  join = st_within
) %>%
  st_join(
    barrios_sf %>% select(nombre, comuna) %>% rename(barrio = nombre),
    join = st_within
  ) %>%
  st_drop_geometry() %>%
  select(grid_id, comuna = comuna.x, barrio)

missing_comuna_idx <- which(is.na(grid_comuna_barrio$comuna))
if (length(missing_comuna_idx) > 0) {
  nearest_idx <- st_nearest_feature(
    grid_centroids_500 %>%
      filter(grid_id %in% grid_comuna_barrio$grid_id[missing_comuna_idx]),
    comunas_sf
  )
  grid_comuna_barrio$comuna[missing_comuna_idx] <- comunas_sf$comuna[nearest_idx]
}

missing_barrio_idx <- which(is.na(grid_comuna_barrio$barrio))
if (length(missing_barrio_idx) > 0) {
  nearest_idx <- st_nearest_feature(
    grid_centroids_500 %>%
      filter(grid_id %in% grid_comuna_barrio$grid_id[missing_barrio_idx]),
    barrios_sf
  )
  grid_comuna_barrio$barrio[missing_barrio_idx] <- barrios_sf$nombre[nearest_idx]
}

stopifnot(sum(is.na(grid_comuna_barrio$comuna)) == 0)
stopifnot(sum(is.na(grid_comuna_barrio$barrio))  == 0)

# =============================================================================
# SECTION 5: CRIME AGGREGATION
# =============================================================================

crimes_base <- crimes_raw %>%
  { if ("grid_id" %in% colnames(.)) select(., -grid_id) else . } %>%
  st_transform(CRS_CABA) %>%
  mutate(
    fecha_dt   = as.Date(Fecha),
    dow        = lubridate::wday(fecha_dt),
    year       = year(fecha_dt),
    month_year = floor_date(fecha_dt, "month"),
    hora_num   = as.integer(as.character(`Franja Horaria`))
  ) %>%
  filter(
    Tipo %in% c("Robo", "Hurto", "Robo automotor",
                "Hurto automotor", "Lesiones Dolosas"),
    year >= 2016L, year <= 2019L,
    !month(fecha_dt) %in% c(1L, 2L),   # exclude school holidays
    hora_num %in% ALL_HOURS
  )

crimes_joined <- st_join(
  crimes_base,
  grid_500 %>% select(grid_id),
  join = st_within
) %>%
  {
    missing <- filter(., is.na(grid_id))
    present <- filter(., !is.na(grid_id))
    if (nrow(missing) > 0) {
      idx <- st_nearest_feature(missing, grid_500)
      missing$grid_id <- grid_500$grid_id[idx]
    }
    bind_rows(present, missing)
  } %>%
  st_drop_geometry() %>%
  filter(!is.na(grid_id))

crimes_tagged <- crimes_joined %>%
  mutate(
    intensity     = case_when(
      hora_num %in% HOURS_AGENTS ~ 0L,
      hora_num %in% HOURS_DOUBLE ~ 1L
    ),
    is_weekday    = as.integer(dow %in% DOW_WEEKDAY),
    is_robo       = as.integer(Tipo == "Robo"),
    is_hurto      = as.integer(Tipo == "Hurto"),
    is_robo_auto  = as.integer(Tipo == "Robo automotor"),
    is_hurto_auto = as.integer(Tipo == "Hurto automotor"),
    is_lesiones   = as.integer(Tipo == "Lesiones Dolosas")
  )

# =============================================================================
# SECTION 6: BALANCED MONTHLY PANEL (infrastructure for bimestre collapse)
# =============================================================================
# months skeleton keeps Jan-Feb for consistent bim_idx arithmetic.
# crimes_tagged excludes those months: Jan-Feb cells will be zero.

months      <- seq(as.Date("2016-01-01"), as.Date("2019-12-01"), by = "month")
n_grids     <- n_distinct(grid_500$grid_id)
intensities <- c(0L, 1L)

aggregate_crimes <- function(df) {
  df %>%
    group_by(grid_id, month_year, intensity) %>%
    summarise(
      n_crimes     = n(),
      n_robos      = sum(is_robo),
      n_hurtos     = sum(is_hurto),
      n_robo_auto  = sum(is_robo_auto),
      n_hurto_auto = sum(is_hurto_auto),
      n_lesiones   = sum(is_lesiones),
      .groups = "drop"
    )
}

agg_weekday <- aggregate_crimes(crimes_tagged %>% filter(is_weekday == 1L))
agg_weekend <- aggregate_crimes(crimes_tagged %>% filter(is_weekday == 0L))

build_balanced <- function(agg, label) {
  skeleton <- expand_grid(
    grid_id    = grid_500$grid_id,
    month_year = months,
    intensity  = intensities
  )
  expected <- n_grids * length(months) * length(intensities)
  panel <- skeleton %>%
    left_join(agg, by = c("grid_id", "month_year", "intensity")) %>%
    mutate(across(c(n_crimes, n_robos, n_hurtos,
                    n_robo_auto, n_hurto_auto, n_lesiones),
                  ~ coalesce(.x, 0L)))
  stopifnot(nrow(panel) == expected)
  cat(sprintf("%s: %d rows\n", label, nrow(panel)))
  panel
}

panel_weekday <- build_balanced(agg_weekday, "Weekday")
panel_weekend <- build_balanced(agg_weekend, "Weekend")

# =============================================================================
# SECTION 7: ENRICH PANELS             ##############
# =============================================================================

grid_covars <- grid_500 %>%
  st_drop_geometry() %>%
  select(grid_id, n_schools, n_pub_schools, n_priv_schools,
         n_bus_stops, n_police, poverty_rate,
         student_density_km2, share_priv_students, women_share,
         pct_commercial, pct_gastronomy)

enrich_panel <- function(panel_raw) {
  panel_raw %>%
    left_join(grid_treatment,  by = "grid_id") %>%
    left_join(grid_covars,     by = "grid_id") %>%
    left_join(sendero_dose %>%
                select(grid_id, sendero_length_m, agentes_asignados,
                       log_sendero_length, log_agentes),
              by = "grid_id") %>%
    left_join(geo_vars_500 %>% select(grid_id, pct_covered),           by = "grid_id") %>%
    left_join(dose_full    %>% select(grid_id, resid_sendero_exposure), by = "grid_id") %>%
    left_join(grid_comuna_barrio,                                       by = "grid_id") %>%
    left_join(grid_zones %>% select(grid_id, zone),                    by = "grid_id") %>%
    mutate(
      month_idx     = as.integer(
        interval(as.Date("2016-01-01"), month_year) %/% months(1)) + 1L,
      quarter_idx   = ceiling(month_idx / 3L),
      year_int      = year(month_year),
      post          = as.integer(month_year >= as.Date("2017-03-01")),
      intensity_num = as.numeric(intensity),
      treated_x_intensity   = treated * as.numeric(intensity),
      is_spillover          = as.integer(zone == "spillover"),
      spillover_x_intensity = is_spillover * as.numeric(intensity),
      across(c(n_schools, n_priv_schools, n_pub_schools, n_bus_stops, n_police,
               pct_commercial, pct_gastronomy), ~ coalesce(.x, 0)),
      student_density_km2 = coalesce(student_density_km2, 0),
      sendero_length_m    = coalesce(sendero_length_m,    0),
      agentes_asignados   = coalesce(agentes_asignados,   0),
      log_sendero_length  = coalesce(log_sendero_length,  0),
      log_agentes         = coalesce(log_agentes,         0),
      pct_covered         = coalesce(pct_covered,         0)
    )
}

panel_weekday <- enrich_panel(panel_weekday)
panel_weekend <- enrich_panel(panel_weekend)

stopifnot(sum(is.na(panel_weekday$treated))                == 0)
stopifnot(sum(is.na(panel_weekday$log_sendero_length))     == 0)
stopifnot(sum(is.na(panel_weekday$log_agentes))            == 0)
stopifnot(sum(is.na(panel_weekday$comuna))                 == 0)
stopifnot(sum(is.na(panel_weekday$resid_sendero_exposure)) == 0)
stopifnot(sum(is.na(panel_weekday$zone))                   == 0)

cat(sprintf("\nmonth_idx: %d-%d | quarter_idx: %d-%d\n",
            min(panel_weekday$month_idx), max(panel_weekday$month_idx),
            min(panel_weekday$quarter_idx), max(panel_weekday$quarter_idx)))
cat(sprintf("Post obs: %.1f%% | Treated grids: %d\n",
            100 * mean(panel_weekday$post), sum(grid_treatment$treated)))

# Verification: no grid can be treated AND spillover simultaneously
table(grid_treatment$treated, grid_zones$zone)

# =============================================================================
# SECTION 8: SAVE INTERMEDIATE OBJECTS                                       #########
# =============================================================================

saveRDS(panel_weekday, "panel_event_study_weekday_2016_2019.rds")
saveRDS(panel_weekend, "panel_event_study_weekend_2016_2019.rds")
saveRDS(sendero_dose,  "sendero_dose_500m.rds")
saveRDS(geo_vars_500,  "geo_vars_500m.rds")
saveRDS(grid_zones,    "grid_zones_500m.rds")

cat("\n=== Sections 1-8 complete ===\n")

# =============================================================================
# SECTION 9: SUN-ABRAHAM — BIMONTHLY PANEL                ########
# =============================================================================
# bim_idx = ceiling(month_idx / 2)
#   month_idx 11 = Nov 2016 -> bim_idx 6  <- REF_BIM
#   month_idx 12 = Dic 2016 -> bim_idx 6
#   month_idx 15 = Mar 2017 -> bim_idx 8  <- COHORT_FASE1
# Jan-Feb months are in skeleton but carry zero crimes (filtered in Section 5).
# =============================================================================

# --- 9A. Crime aggregation to grid x month x slot (weekday only) ---
crimes_sa <- crimes_tagged %>%
  filter(is_weekday == 1L) %>%
  inner_join(SLOT_MAP, by = "hora_num") %>%
  mutate(slot = factor(slot, levels = SLOT_LEVELS))

agg_sa <- crimes_sa %>%
  group_by(grid_id, month_year, slot) %>%
  summarise(
    n_robos  = sum(is_robo),
    n_hurtos = sum(is_hurto),
    n_crimes = n(),
    .groups  = "drop"
  )

# --- 9B. Balanced skeleton -> bimestre collapse ---
slots_vec <- factor(SLOT_LEVELS, levels = SLOT_LEVELS)

skeleton_sa <- expand_grid(
  grid_id    = grid_500$grid_id,
  month_year = months,
  slot       = slots_vec
)

panel_sa_monthly <- skeleton_sa %>%
  left_join(agg_sa, by = c("grid_id", "month_year", "slot")) %>%
  mutate(across(c(n_robos, n_hurtos, n_crimes), ~ coalesce(.x, 0L))) %>%
  left_join(SLOT_INDICATORS, by = "slot") %>%
  mutate(
    month_idx = as.integer(
      interval(as.Date("2016-01-01"), month_year) %/% months(1)
    ) + 1L,
    bim_idx = ceiling(month_idx / 2L)
  )

stopifnot(nrow(panel_sa_monthly) ==
            n_distinct(grid_500$grid_id) * length(months) * length(SLOT_LEVELS))

panel_sa_bim <- panel_sa_monthly %>%
  group_by(grid_id, bim_idx, slot) %>%
  summarise(
    n_robos        = sum(n_robos),
    n_hurtos       = sum(n_hurtos),
    n_crimes       = sum(n_crimes),
    intensity_num  = first(intensity_num),
    is_school_time = first(is_school_time),
    .groups        = "drop"
  ) %>%
  mutate(
    slot    = factor(slot, levels = SLOT_LEVELS),
    bim_idx = as.integer(bim_idx)
  )

cat(sprintf("panel_sa_bim: %d rows | bim_idx %d-%d\n",
            nrow(panel_sa_bim),
            min(panel_sa_bim$bim_idx),
            max(panel_sa_bim$bim_idx)))

# --- 9C. Cohort assignment ---
dose_fase1 <- sendero_length_raw %>%
  left_join(
    senderos_raw %>% filter(id <= 207) %>% distinct(id) %>% mutate(fase = 1L),
    by = "id"
  ) %>%
  filter(!is.na(fase)) %>%
  group_by(grid_id) %>%
  summarise(length_fase1 = sum(length_m), .groups = "drop")

senderos_lines_expansion <- senderos_raw %>%
  filter(id > 207) %>%
  distinct(id, .keep_all = TRUE) %>%
  st_as_sf(wkt = "geometry", crs = 4326) %>%
  st_transform(CRS_CABA) %>%
  select(id)

dose_fase2_raw <- st_intersection(
  grid_500 %>% select(grid_id),
  senderos_lines_expansion
) %>%
  st_collection_extract("LINESTRING") %>%
  mutate(length_m = as.numeric(st_length(.))) %>%
  filter(length_m > 0) %>%
  st_drop_geometry() %>%
  group_by(grid_id) %>%
  summarise(length_fase2 = sum(length_m), .groups = "drop")

cohort_table_bim <- grid_500 %>%
  st_drop_geometry() %>%
  select(grid_id) %>%
  left_join(dose_fase1,     by = "grid_id") %>%
  left_join(dose_fase2_raw, by = "grid_id") %>%
  mutate(
    length_fase1 = coalesce(length_fase1, 0),
    length_fase2 = coalesce(length_fase2, 0),
    cohort_bim   = case_when(
      length_fase1 > DOSE_THRESHOLD ~ COHORT_FASE1,
      length_fase2 > DOSE_THRESHOLD ~ COHORT_FASE2,
      TRUE                          ~ NA_integer_
    )
  )

cat(sprintf(
  "\nCohort assignment (threshold %dm):\n  Fase1 (bim %d): %d grids\n  Fase2 (bim %d): %d grids\n  Excluded: %d grids\n",
  DOSE_THRESHOLD,
  COHORT_FASE1, sum(cohort_table_bim$cohort_bim == COHORT_FASE1, na.rm = TRUE),
  COHORT_FASE2, sum(cohort_table_bim$cohort_bim == COHORT_FASE2, na.rm = TRUE),
  sum(is.na(cohort_table_bim$cohort_bim))
))

# Threshold sensitivity preview
for (thresh in c(50, 100, 200, 300, 400)) {
  ct <- cohort_table_bim %>%
    mutate(cohort_bim = case_when(
      length_fase1 > thresh ~ COHORT_FASE1,
      length_fase2 > thresh ~ COHORT_FASE2,
      TRUE                  ~ NA_integer_
    ))
  cat(sprintf("Threshold %dm — Fase1: %d | Fase2: %d | Excluded: %d\n",
              thresh,
              sum(ct$cohort_bim == COHORT_FASE1, na.rm = TRUE),
              sum(ct$cohort_bim == COHORT_FASE2, na.rm = TRUE),
              sum(is.na(ct$cohort_bim))))
}

# --- 9D. Grid-level covariates ---
grid_covars_sa <- grid_500 %>%
  st_drop_geometry() %>%
  select(grid_id, n_bus_stops, n_schools, n_pub_schools, n_priv_schools,
         poverty_rate, pct_commercial, pct_gastronomy,
         share_priv_students, women_share)

# --- 9E. Final SA panel ---
panel_sa <- panel_sa_bim %>%
  inner_join(cohort_table_bim %>% filter(!is.na(cohort_bim)), by = "grid_id") %>%
  left_join(grid_covars_sa, by = "grid_id") %>%
  mutate(
    cohort_bim          = as.numeric(cohort_bim),
    bim_idx             = as.integer(bim_idx),
    intensity_x_school  = intensity_num * is_school_time,
    poverty_rate        = coalesce(poverty_rate, 0),
    share_priv_students = coalesce(share_priv_students, 0),
    across(c(n_schools, n_pub_schools, n_priv_schools,
             n_bus_stops, pct_commercial, pct_gastronomy), ~ coalesce(.x, 0))
  )

# Bimestres with Jan-Feb: bim_idx 1 (Jan-Feb 2016), 7 (Jan-Feb 2017),
#                        13 (Jan-Feb 2018), 19 (Jan-Feb 2019)
BIMS_HOLIDAY <- c(1L, 7L, 13L, 19L)

panel_sa <- panel_sa %>%
  filter(!bim_idx %in% BIMS_HOLIDAY)

# Lo mismo para panel_sa_bim antes de construir panel_sa
panel_sa_bim <- panel_sa_bim %>%
  filter(!bim_idx %in% BIMS_HOLIDAY)

stopifnot(sum(is.na(panel_sa$cohort_bim))   == 0)
stopifnot(sum(is.na(panel_sa$n_bus_stops))  == 0)
stopifnot(sum(is.na(panel_sa$poverty_rate)) == 0)

cat(sprintf("panel_sa (bim): %d rows | %d grids | bim %d-%d\n",
            nrow(panel_sa),
            n_distinct(panel_sa$grid_id),
            min(panel_sa$bim_idx),
            max(panel_sa$bim_idx)))

# =============================================================================
# SECTION 10: SA HELPER FUNCTIONS                                                       ####### 
# =============================================================================

run_sa <- function(data, slot_label, outcome = "n_robos") {
  cat(sprintf("\n--- SA: %s | outcome: %s ---\n", slot_label, outcome))
  
  fml <- reformulate(
    termlabels = c("sunab(cohort_bim, bim_idx)", "n_bus_stops"),
    response   = outcome,
    env        = parent.frame()
  )
  
  m <- fepois(fml, data = data, cluster = ~grid_id)
  
  pre <- grep("bim_idx::[2-5]$", names(coef(m)), value = TRUE)  # excluye bim 1
  post <- grep("bim_idx::[8-9]$|bim_idx::1[0-9]$|bim_idx::2[0-4]$",
               names(coef(m)), value = TRUE)
  
  if (length(pre)  > 0) { cat("  Pre-trend Wald:");  print(wald(m, pre))  }
  if (length(post) > 0) { cat("  Post Wald:");       print(wald(m, post)) }
  
  cf      <- coef(m); se <- se(m); nm <- names(cf)
  sa_idx  <- grep("^bim_idx::", nm)
  rel_vals <- as.integer(sub("^bim_idx::", "", nm[sa_idx]))
  abs_vals <- rel_vals + COHORT_FASE1
  
  df_plot <- data.frame(
    bim_idx = abs_vals,
    est     = unname(cf[sa_idx]),
    lo      = unname(cf[sa_idx]) - 1.96 * unname(se[sa_idx]),
    hi      = unname(cf[sa_idx]) + 1.96 * unname(se[sa_idx])
  ) %>%
    bind_rows(data.frame(bim_idx = REF_BIM, est = 0, lo = 0, hi = 0)) %>%
    arrange(bim_idx)
  
  p <- ggplot(df_plot, aes(x = bim_idx, y = est)) +
    geom_hline(yintercept = 0, linetype = "dashed", color = "gray50") +
    geom_vline(xintercept = REF_BIM + 0.5, linetype = "dashed", color = "steelblue") +
    geom_ribbon(aes(ymin = lo, ymax = hi), alpha = 0.15) +
    geom_line() + geom_point(size = 1.8) +
    scale_x_continuous(breaks = seq(1, 24, by = 2),
                       labels = function(x) sprintf("B%d", x)) +
    labs(
      title = sprintf("Sun-Abraham ATT — %s (%s)", slot_label, outcome),
      x     = sprintf("Bimestre (ref = B%d, Nov-Dic 2016)", REF_BIM),
      y     = "ATT (Poisson semi-elasticity)"
    ) +
    theme_bw()
  print(p)
  m
}

extract_sa_coefs <- function(m, label, cohort_first = COHORT_FASE1) {
  cf  <- coef(m); se <- se(m); nm <- names(cf)
  idx <- grep("^bim_idx::", nm)
  rel_vals <- as.integer(sub("^bim_idx::", "", nm[idx]))
  abs_vals <- rel_vals + cohort_first
  data.frame(
    bim_idx = abs_vals,
    est     = unname(cf[idx]),
    lo      = unname(cf[idx]) - 1.96 * unname(se[idx]),
    hi      = unname(cf[idx]) + 1.96 * unname(se[idx]),
    label   = label
  )
}

# =============================================================================
# SECTION 11: MAIN SA MODELS — SLOT DECOMPOSITION                                          ####
# =============================================================================

panel_sa_int0   <- panel_sa %>% filter(slot %in% c("control",     "school_only"))
panel_sa_int1   <- panel_sa %>% filter(slot %in% c("double_only", "school_double"))
panel_sa_school <- panel_sa %>% filter(slot %in% c("school_only", "school_double"))
panel_sa_nosch  <- panel_sa %>% filter(slot %in% c("control",     "double_only"))

m_sa_int0   <- run_sa(panel_sa_int0,   "intensity=0 (no extra enforcement)")
m_sa_int1   <- run_sa(panel_sa_int1,   "intensity=1 (agents + police)")
m_sa_school <- run_sa(panel_sa_school, "school_time=1 (transition hours)")
m_sa_nosch  <- run_sa(panel_sa_nosch,  "school_time=0 (non-transition hours)")

# Overlay: intensity=0 vs intensity=1
df_int_compare <- bind_rows(
  extract_sa_coefs(m_sa_int0, "intensity=0"),
  extract_sa_coefs(m_sa_int1, "intensity=1")
) %>%
  bind_rows(data.frame(bim_idx = REF_BIM, est = 0, lo = 0, hi = 0,
                       label = c("intensity=0", "intensity=1"))) %>%
  arrange(label, bim_idx)

ggplot(df_int_compare, aes(x = bim_idx, y = est, color = label, fill = label)) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "gray50") +
  geom_vline(xintercept = REF_BIM + 0.5, linetype = "dashed", color = "steelblue") +
  geom_ribbon(aes(ymin = lo, ymax = hi), alpha = 0.12, color = NA) +
  geom_line() + geom_point(size = 1.8) +
  scale_x_continuous(breaks = seq(1, 24, by = 2),
                     labels = function(x) sprintf("B%d", x)) +
  labs(title = "Sun-Abraham: intensity=0 vs intensity=1",
       x     = sprintf("Bimestre (ref = B%d, Nov-Dic 2016)", REF_BIM),
       y     = "ATT (Poisson semi-elasticity)", color = NULL, fill = NULL) +
  theme_bw() + theme(legend.position = "bottom")

# Overlay: school_time=1 vs school_time=0
df_school_compare <- bind_rows(
  extract_sa_coefs(m_sa_school, "school_time=1"),
  extract_sa_coefs(m_sa_nosch,  "school_time=0")
) %>%
  bind_rows(data.frame(bim_idx = REF_BIM, est = 0, lo = 0, hi = 0,
                       label = c("school_time=1", "school_time=0"))) %>%
  arrange(label, bim_idx)

ggplot(df_school_compare, aes(x = bim_idx, y = est, color = label, fill = label)) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "gray50") +
  geom_vline(xintercept = REF_BIM + 0.5, linetype = "dashed", color = "steelblue") +
  geom_ribbon(aes(ymin = lo, ymax = hi), alpha = 0.12, color = NA) +
  geom_line() + geom_point(size = 1.8) +
  scale_x_continuous(breaks = seq(1, 24, by = 2),
                     labels = function(x) sprintf("B%d", x)) +
  labs(title = "Sun-Abraham: school transition vs non-transition hours",
       x     = sprintf("Bimestre (ref = B%d, Nov-Dic 2016)", REF_BIM),
       y     = "ATT (Poisson semi-elasticity)", color = NULL, fill = NULL) +
  theme_bw() + theme(legend.position = "bottom")

etable(
  m_sa_int0, m_sa_int1, m_sa_school, m_sa_nosch,
  headers = c("intensity=0", "intensity=1", "school_time=1", "school_time=0"),
  digits  = 3,
  title   = "Sun-Abraham ATT by Slot Category (Bimonthly)"
)

# =============================================================================
# SECTION 12: HETEROGENEITY — SECTOR (pub/priv) AND POVERTY                    ####
# =============================================================================
# Migrated from TWFE framework to SA bimestral.
# Strategy: time-invariant moderators interacted with post dummy.
# pub_x_post / priv_x_post / pov_x_post enter as scalar controls alongside sunab().
# Identification: cross-sectional variation in moderator x post timing.
# Base panel: panel_sa_int1 (intensity=1 — most policy-relevant slot pair).
# =============================================================================

stopifnot(sum(is.na(panel_sa$n_pub_schools))       == 0)
stopifnot(sum(is.na(panel_sa$n_priv_schools))      == 0)
stopifnot(sum(is.na(panel_sa$share_priv_students)) == 0)
stopifnot(sum(is.na(panel_sa$poverty_rate))        == 0)

panel_sa <- panel_sa %>%
  mutate(
    post        = as.integer(bim_idx >= COHORT_FASE1),
    pub_x_post  = n_pub_schools  * post,
    priv_x_post = n_priv_schools * post,
    pov_x_post  = poverty_rate   * post
  )

# Rebuild intensity=1 subset with new columns
panel_sa_int1 <- panel_sa %>% filter(slot %in% c("double_only", "school_double"))

# --- H1: Sector heterogeneity ---
m_het_sector <- fepois(
  n_robos ~ sunab(cohort_bim, bim_idx) +
    pub_x_post + priv_x_post + n_bus_stops |
    grid_id + bim_idx,
  data    = panel_sa_int1,
  cluster = ~grid_id
)
summary(m_het_sector)
cat("\n--- H1: pub_x_post ---\n");  print(coef(m_het_sector)["pub_x_post"])
cat("--- H1: priv_x_post ---\n"); print(coef(m_het_sector)["priv_x_post"])

# --- H2: Poverty heterogeneity ---
m_het_poverty <- fepois(
  n_robos ~ sunab(cohort_bim, bim_idx) +
    pov_x_post + n_bus_stops |
    grid_id + bim_idx,
  data    = panel_sa_int1,
  cluster = ~grid_id
)
summary(m_het_poverty)
cat("\n--- H2: pov_x_post ---\n"); print(coef(m_het_poverty)["pov_x_post"])

# --- H3: Full heterogeneity (sector + poverty jointly) ---
m_het_full <- fepois(
  n_robos ~ sunab(cohort_bim, bim_idx) +
    pub_x_post + priv_x_post + pov_x_post + n_bus_stops |
    grid_id + bim_idx,
  data    = panel_sa_int1,
  cluster = ~grid_id
)
summary(m_het_full)

etable(
  m_sa_int1, m_het_sector, m_het_poverty, m_het_full,
  keep   = c("pub_x_post", "priv_x_post", "pov_x_post"),
  digits = 3,
  title  = "SA Heterogeneity: Sector and Poverty (intensity=1 panel)"
)



# =============================================================================
# SECTION 12B: HETEROGENEITY EVENT STUDY — SUBGROUP SA
# =============================================================================

# --- Sector subgroups ---
panel_sa_int1 <- panel_sa_int1 %>%
  mutate(sector_dom = case_when(
    n_pub_schools > n_priv_schools ~ "public_dominant",
    n_priv_schools > n_pub_schools ~ "private_dominant",
    TRUE                           ~ "mixed"
  ))

panel_pub  <- panel_sa_int1 %>% filter(sector_dom == "public_dominant")
panel_priv <- panel_sa_int1 %>% filter(sector_dom == "private_dominant")

# Check Fase1 grid counts before running
cat(sprintf("Public-dominant  Fase1 grids: %d\n",
            panel_pub  %>% filter(cohort_bim == COHORT_FASE1) %>% 
              summarise(n = n_distinct(grid_id)) %>% pull(n)))
cat(sprintf("Private-dominant Fase1 grids: %d\n",
            panel_priv %>% filter(cohort_bim == COHORT_FASE1) %>% 
              summarise(n = n_distinct(grid_id)) %>% pull(n)))

m_het_pub  <- run_sa(panel_pub,  "Public-dominant grids",  "n_robos")
m_het_priv <- run_sa(panel_priv, "Private-dominant grids", "n_robos")

# Overlay sector
df_sector <- bind_rows(
  extract_sa_coefs(m_het_pub,  "Public-dominant"),
  extract_sa_coefs(m_het_priv, "Private-dominant")
) %>%
  bind_rows(data.frame(
    bim_idx = rep(REF_BIM, 2), est = 0, lo = 0, hi = 0,
    label   = c("Public-dominant", "Private-dominant")
  )) %>%
  arrange(label, bim_idx)

p_het_sector <- ggplot(df_sector, aes(x = bim_idx, y = est,
                                      color = label, fill = label)) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "gray50") +
  geom_vline(xintercept = REF_BIM + 0.5, linetype = "dashed",
             color = "steelblue") +
  geom_ribbon(aes(ymin = lo, ymax = hi), alpha = 0.12, color = NA) +
  geom_line() + geom_point(size = 1.8) +
  scale_x_continuous(breaks = seq(1, 24, by = 2),
                     labels = function(x) sprintf("B%d", x)) +
  scale_color_manual(values = c("Public-dominant"  = "#0072B2",
                                "Private-dominant" = "#D55E00")) +
  scale_fill_manual(values  = c("Public-dominant"  = "#0072B2",
                                "Private-dominant" = "#D55E00")) +
  labs(title = NULL,
       x     = sprintf("Bimonthly period (ref = B%d, Nov–Dec 2016)", REF_BIM),
       y     = "ATT (Poisson semi-elasticity)",
       color = NULL, fill = NULL) +
  theme_bw(base_size = 11) +
  theme(legend.position = "bottom", panel.grid.minor = element_blank())

ggsave("heterogeneity_sector.png", p_het_sector,
       width = 10, height = 6, dpi = 150)

# --- Poverty subgroups ---
pov_median <- median(
  panel_sa_int1$poverty_rate[panel_sa_int1$poverty_rate > 0],
  na.rm = TRUE
)
cat(sprintf("Poverty median (non-zero): %.4f\n", pov_median))

panel_pov_hi <- panel_sa_int1 %>% filter(poverty_rate >= pov_median)
panel_pov_lo <- panel_sa_int1 %>% filter(poverty_rate <  pov_median)

cat(sprintf("High-poverty Fase1 grids: %d\n",
            panel_pov_hi %>% filter(cohort_bim == COHORT_FASE1) %>%
              summarise(n = n_distinct(grid_id)) %>% pull(n)))
cat(sprintf("Low-poverty  Fase1 grids: %d\n",
            panel_pov_lo %>% filter(cohort_bim == COHORT_FASE1) %>%
              summarise(n = n_distinct(grid_id)) %>% pull(n)))

m_het_pov_hi <- run_sa(panel_pov_hi, "High poverty", "n_robos")
m_het_pov_lo <- run_sa(panel_pov_lo, "Low poverty",  "n_robos")

# Overlay poverty
df_poverty <- bind_rows(
  extract_sa_coefs(m_het_pov_hi, "High poverty"),
  extract_sa_coefs(m_het_pov_lo, "Low poverty")
) %>%
  bind_rows(data.frame(
    bim_idx = rep(REF_BIM, 2), est = 0, lo = 0, hi = 0,
    label   = c("High poverty", "Low poverty")
  )) %>%
  arrange(label, bim_idx)

p_het_poverty <- ggplot(df_poverty, aes(x = bim_idx, y = est,
                                        color = label, fill = label)) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "gray50") +
  geom_vline(xintercept = REF_BIM + 0.5, linetype = "dashed",
             color = "steelblue") +
  geom_ribbon(aes(ymin = lo, ymax = hi), alpha = 0.12, color = NA) +
  geom_line() + geom_point(size = 1.8) +
  scale_x_continuous(breaks = seq(1, 24, by = 2),
                     labels = function(x) sprintf("B%d", x)) +
  scale_color_manual(values = c("High poverty" = "#CC79A7",
                                "Low poverty"  = "#009E73")) +
  scale_fill_manual(values  = c("High poverty" = "#CC79A7",
                                "Low poverty"  = "#009E73")) +
  labs(title = NULL,
       x     = sprintf("Bimonthly period (ref = B%d, Nov–Dec 2016)", REF_BIM),
       y     = "ATT (Poisson semi-elasticity)",
       color = NULL, fill = NULL) +
  theme_bw(base_size = 11) +
  theme(legend.position = "bottom", panel.grid.minor = element_blank())

ggsave("heterogeneity_poverty.png", p_het_poverty,
       width = 10, height = 6, dpi = 150)

cat("Heterogeneity event study figures exported.\n")







# =============================================================================
# SECTION 12C: LaTeX EXPORT — HETEROGENEITY TABLES
# =============================================================================

dir.create("tables", showWarnings = FALSE)

etable(
  m_sa_int1, m_het_pub, m_het_priv,
  headers  = c("Baseline", "Public-dominant", "Private-dominant"),
  digits   = 3,
  se.below = TRUE,
  depvar   = FALSE,
  title    = "Senderos Escolares: Heterogeneity by School Sector (SA, intensity$=1$)",
  notes    = "Poisson QMLE. Sun-Abraham estimator. Subgroups defined by $N^{\\text{pub}}_g > N^{\\text{priv}}_g$ (public-dominant) and vice versa. Grid and bimestre FE. Cluster SE by grid. $^{*}p<0.10$, $^{**}p<0.05$, $^{***}p<0.01$.",
  tex      = TRUE,
  file     = "tables/tab_het_sector.tex",
  replace  = TRUE
)

etable(
  m_sa_int1, m_het_pov_hi, m_het_pov_lo,
  headers  = c("Baseline", "High poverty", "Low poverty"),
  digits   = 3,
  se.below = TRUE,
  depvar   = FALSE,
  title    = "Senderos Escolares: Heterogeneity by Poverty Rate (SA, intensity$=1$)",
  notes = sprintf("Poisson QMLE. Sun-Abraham estimator. High/low poverty split at median NBI rate among non-zero grids (%.4f). Grid and bimestre FE. Cluster SE by grid. $^{*}p<0.10$, $^{**}p<0.05$, $^{***}p<0.01$.", pov_median),
  tex      = TRUE,
  file     = "tables/tab_het_poverty.tex",
  replace  = TRUE
)

cat("Heterogeneity tables exported to tables/tab_het_sector.tex and tables/tab_het_poverty.tex\n")


# =============================================================================
# SECTION 13: ROBUSTNESS — ALTERNATIVE OUTCOMES AND ENTRY/EXIT SLOTS                   ########
# =============================================================================

# --- 13A. Alternative outcomes ---
for (outcome in c("n_crimes", "n_hurtos")) {
  cat(sprintf("\n========== OUTCOME: %s ==========\n", outcome))
  
  m_int0   <- run_sa(panel_sa_int0,   "intensity=0", outcome)
  m_int1   <- run_sa(panel_sa_int1,   "intensity=1", outcome)
  m_school <- run_sa(panel_sa_school, "school_time=1", outcome)
  m_nosch  <- run_sa(panel_sa_nosch,  "school_time=0", outcome)
  
  df_int <- bind_rows(
    extract_sa_coefs(m_int0, "intensity=0"),
    extract_sa_coefs(m_int1, "intensity=1")
  ) %>%
    bind_rows(data.frame(bim_idx = REF_BIM, est = 0, lo = 0, hi = 0,
                         label = c("intensity=0", "intensity=1"))) %>%
    arrange(label, bim_idx)
  
  p_int <- ggplot(df_int, aes(x = bim_idx, y = est, color = label, fill = label)) +
    geom_hline(yintercept = 0, linetype = "dashed", color = "gray50") +
    geom_vline(xintercept = REF_BIM + 0.5, linetype = "dashed", color = "steelblue") +
    geom_ribbon(aes(ymin = lo, ymax = hi), alpha = 0.12, color = NA) +
    geom_line() + geom_point(size = 1.8) +
    scale_x_continuous(breaks = seq(1, 24, by = 2),
                       labels = function(x) sprintf("B%d", x)) +
    labs(title  = sprintf("SA: intensity=0 vs intensity=1 (%s)", outcome),
         x      = sprintf("Bimestre (ref = B%d, Nov-Dic 2016)", REF_BIM),
         y      = "ATT (Poisson semi-elasticity)", color = NULL, fill = NULL) +
    theme_bw() + theme(legend.position = "bottom")
  print(p_int)
  ggsave(sprintf("sa_%s_intensity_compare.png", outcome),
         p_int, width = 10, height = 6, dpi = 300)
  
  etable(m_int0, m_int1, m_school, m_nosch,
         headers = c("intensity=0", "intensity=1", "school_time=1", "school_time=0"),
         digits  = 3,
         title   = sprintf("SA ATT by Slot — %s", outcome))
}

# --- 13B. Entry vs exit slot decomposition ---
SLOT_MAP_EX <- tribble(
  ~hora_num, ~slot_ex,
  6L,  "control",   9L,  "control",  10L, "control",
  11L, "control",  13L, "control",  14L, "control",
  15L, "control",  18L, "control",  19L, "control",
  7L,  "entry",     8L,  "entry",
  12L, "exit_primaria",
  16L, "exit_secundaria", 17L, "exit_secundaria"
)

SLOT_LEVELS_EX <- c("control", "entry", "exit_primaria", "exit_secundaria")
stopifnot(nrow(SLOT_MAP_EX) == 14L)
stopifnot(!anyDuplicated(SLOT_MAP_EX$hora_num))

crimes_ex <- crimes_tagged %>%
  filter(is_weekday == 1L) %>%
  inner_join(SLOT_MAP_EX, by = "hora_num") %>%
  mutate(slot_ex = factor(slot_ex, levels = SLOT_LEVELS_EX))

agg_ex <- crimes_ex %>%
  group_by(grid_id, month_year, slot_ex) %>%
  summarise(n_robos = sum(is_robo), n_hurtos = sum(is_hurto),
            n_crimes = n(), .groups = "drop")

panel_ex_bim <- expand_grid(
  grid_id    = grid_500$grid_id,
  month_year = months,
  slot_ex    = factor(SLOT_LEVELS_EX, levels = SLOT_LEVELS_EX)
) %>%
  left_join(agg_ex, by = c("grid_id", "month_year", "slot_ex")) %>%
  mutate(
    across(c(n_robos, n_hurtos, n_crimes), ~ coalesce(.x, 0L)),
    month_idx = as.integer(interval(as.Date("2016-01-01"), month_year) %/% months(1)) + 1L,
    bim_idx   = ceiling(month_idx / 2L)
  ) %>%
  group_by(grid_id, bim_idx, slot_ex) %>%
  summarise(n_robos = sum(n_robos), n_hurtos = sum(n_hurtos),
            n_crimes = sum(n_crimes), .groups = "drop") %>%
  mutate(slot_ex = factor(slot_ex, levels = SLOT_LEVELS_EX),
         bim_idx = as.integer(bim_idx)) %>%
  inner_join(cohort_table_bim %>% filter(!is.na(cohort_bim)), by = "grid_id") %>%
  left_join(grid_covars_sa %>% select(grid_id, n_bus_stops), by = "grid_id") %>%
  mutate(cohort_bim = as.numeric(cohort_bim), bim_idx = as.integer(bim_idx))

stopifnot(sum(is.na(panel_ex_bim$cohort_bim))  == 0)
stopifnot(sum(is.na(panel_ex_bim$n_bus_stops)) == 0)

panel_entry  <- panel_ex_bim %>% filter(slot_ex %in% c("control", "entry"))
panel_exit_p <- panel_ex_bim %>% filter(slot_ex %in% c("control", "exit_primaria"))
panel_exit_s <- panel_ex_bim %>% filter(slot_ex %in% c("control", "exit_secundaria"))

bim_excluir <- c(1, 7, 13, 19)




for (outcome in c("n_robos", "n_hurtos", "n_crimes")) {
  
  panel_entry_f  <- panel_entry  %>% filter(!bim_idx %in% bim_excluir)
  panel_exit_p_f <- panel_exit_p %>% filter(!bim_idx %in% bim_excluir)
  panel_exit_s_f <- panel_exit_s %>% filter(!bim_idx %in% bim_excluir)
  
  cat(sprintf("\n========== Entry/Exit slots — %s ==========\n", outcome))
  
  m_entry  <- run_sa(panel_entry_f,  "entry (7-8h)",             outcome)
  m_exit_p <- run_sa(panel_exit_p_f, "exit primaria (12h)",      outcome)
  m_exit_s <- run_sa(panel_exit_s_f, "exit secundaria (16-17h)", outcome)
  
  df_ex <- bind_rows(
    extract_sa_coefs(m_entry,  "entry"),
    extract_sa_coefs(m_exit_p, "exit_primaria"),
    extract_sa_coefs(m_exit_s, "exit_secundaria")
  ) %>%
    bind_rows(data.frame(bim_idx = rep(REF_BIM, 3), est = 0, lo = 0, hi = 0,
                         label   = c("entry", "exit_primaria", "exit_secundaria"))) %>%
    arrange(label, bim_idx)
  
  p_ex <- ggplot(df_ex, aes(x = bim_idx, y = est, color = label, fill = label)) +
    geom_hline(yintercept = 0, linetype = "dashed", color = "gray50") +
    geom_vline(xintercept = REF_BIM + 0.5, linetype = "dashed", color = "steelblue") +
    geom_ribbon(aes(ymin = lo, ymax = hi), alpha = 0.10, color = NA) +
    geom_line() + geom_point(size = 1.8) +
    scale_x_continuous(breaks = seq(1, 24, by = 2),
                       labels = function(x) sprintf("B%d", x)) +
    labs(title  = sprintf("SA: Entry vs Exit slots (%s)", outcome),
         x      = sprintf("Bimestre (ref = B%d, Nov-Dic 2016)", REF_BIM),
         y      = "ATT (Poisson semi-elasticity)", color = NULL, fill = NULL) +
    theme_bw() + theme(legend.position = "bottom")
  print(p_ex)
  ggsave(sprintf("sa_entry_exit_%s.png", outcome),
         p_ex, width = 10, height = 6, dpi = 300)
  
  etable(m_entry, m_exit_p, m_exit_s,
         headers = c("entry", "exit_primaria", "exit_secundaria"),
         digits  = 3,
         title   = sprintf("SA ATT: Entry vs Exit Slots (%s)", outcome))
}

# =============================================================================
# SECTION 14: DOSE THRESHOLD SENSITIVITY                                      #######
# =============================================================================

# =============================================================================
# SECTION 14: DOSE THRESHOLD SENSITIVITY — intensity=0 AND intensity=1
# =============================================================================

BIMS_HOLIDAY <- c(1L, 7L, 13L, 19L)
thresh_models_int0 <- list()
thresh_models_int1 <- list()

for (thresh in c(50L, 100L, 200L, 300L, 400L)) {
  ct <- cohort_table_bim %>%
    mutate(cohort_bim = case_when(
      length_fase1 > thresh ~ COHORT_FASE1,
      length_fase2 > thresh ~ COHORT_FASE2,
      TRUE                  ~ NA_integer_
    ))
  
  panel_t <- panel_sa_bim %>%
    filter(!bim_idx %in% BIMS_HOLIDAY) %>%
    inner_join(ct %>% filter(!is.na(cohort_bim)), by = "grid_id") %>%
    left_join(grid_covars_sa %>% select(grid_id, n_bus_stops), by = "grid_id") %>%
    mutate(cohort_bim = as.numeric(cohort_bim), bim_idx = as.integer(bim_idx))
  
  panel_t_int0 <- panel_t %>% filter(slot %in% c("control", "school_only"))
  panel_t_int1 <- panel_t %>% filter(slot %in% c("double_only", "school_double"))
  
  m_t0 <- fepois(
    reformulate(c("sunab(cohort_bim, bim_idx)", "n_bus_stops"),
                response = "n_robos", env = parent.frame()),
    data = panel_t_int0, cluster = ~grid_id
  )
  m_t1 <- fepois(
    reformulate(c("sunab(cohort_bim, bim_idx)", "n_bus_stops"),
                response = "n_robos", env = parent.frame()),
    data = panel_t_int1, cluster = ~grid_id
  )
  
  # Wald tests
  pre0  <- grep("bim_idx::[2-5]$", names(coef(m_t0)), value = TRUE)
  post0 <- grep("bim_idx::[8-9]$|bim_idx::1[0-9]$|bim_idx::2[0-4]$",
                names(coef(m_t0)), value = TRUE)
  pre1  <- grep("bim_idx::[2-5]$", names(coef(m_t1)), value = TRUE)
  post1 <- grep("bim_idx::[8-9]$|bim_idx::1[0-9]$|bim_idx::2[0-4]$",
                names(coef(m_t1)), value = TRUE)
  
  cat(sprintf("\nThreshold %dm | Fase1: %d grids\n",
              thresh, sum(ct$cohort_bim == COHORT_FASE1, na.rm = TRUE)))
  cat("--- intensity=0 | Pre:"); print(wald(m_t0, pre0))
  cat("--- intensity=0 | Post:"); print(wald(m_t0, post0))
  cat("--- intensity=1 | Pre:"); print(wald(m_t1, pre1))
  cat("--- intensity=1 | Post:"); print(wald(m_t1, post1))
  
  thresh_models_int0[[as.character(thresh)]] <- m_t0
  thresh_models_int1[[as.character(thresh)]] <- m_t1
  
  # Overlay plot: intensity=0 vs intensity=1
  df_t <- bind_rows(
    extract_sa_coefs(m_t0, "intensity=0") %>%
      bind_rows(data.frame(bim_idx = REF_BIM, est = 0, lo = 0, hi = 0,
                           label = "intensity=0")),
    extract_sa_coefs(m_t1, "intensity=1") %>%
      bind_rows(data.frame(bim_idx = REF_BIM, est = 0, lo = 0, hi = 0,
                           label = "intensity=1"))
  ) %>% arrange(label, bim_idx)
  
  p_t <- ggplot(df_t, aes(x = bim_idx, y = est, color = label, fill = label)) +
    geom_hline(yintercept = 0, linetype = "dashed", color = "gray50") +
    geom_vline(xintercept = REF_BIM + 0.5, linetype = "dashed",
               color = "steelblue") +
    geom_ribbon(aes(ymin = lo, ymax = hi), alpha = 0.12, color = NA) +
    geom_line() + geom_point(size = 1.8) +
    scale_x_continuous(breaks = seq(1, 24, by = 2),
                       labels = function(x) sprintf("B%d", x)) +
    scale_color_manual(values = c("intensity=0" = "#D55E00",
                                  "intensity=1" = "#0072B2")) +
    scale_fill_manual(values  = c("intensity=0" = "#D55E00",
                                  "intensity=1" = "#0072B2")) +
    labs(title = sprintf("SA Threshold %dm — intensity=0 vs intensity=1",
                         thresh),
         x     = sprintf("Bimonthly period (ref = B%d, Nov–Dec 2016)", REF_BIM),
         y     = "ATT (Poisson semi-elasticity)",
         color = NULL, fill = NULL) +
    theme_bw(base_size = 11) +
    theme(legend.position = "bottom", panel.grid.minor = element_blank())
  
  print(p_t)
  ggsave(sprintf("sa_thresh_%d.png", thresh),
         p_t, width = 10, height = 6, dpi = 150)
  ggsave(sprintf("sa_thresh_%d.pdf", thresh),
         p_t, width = 10, height = 6)
}

# Export tabla intensity=0
etable(
  thresh_models_int0[["50"]], thresh_models_int0[["100"]],
  thresh_models_int0[["200"]], thresh_models_int0[["300"]],
  thresh_models_int0[["400"]],
  headers  = c("50m", "100m", "200m", "300m", "400m"),
  digits   = 3,
  se.below = TRUE,
  depvar   = FALSE,
  title    = "SA Threshold Sensitivity: intensity$=0$ (agents only), $n\\_robos$",
  tex      = TRUE,
  file     = "tables/tab_A1_sa_threshold_sensitivity.tex",
  replace  = TRUE
)

# Export tabla intensity=1
etable(
  thresh_models_int1[["50"]], thresh_models_int1[["100"]],
  thresh_models_int1[["200"]], thresh_models_int1[["300"]],
  thresh_models_int1[["400"]],
  headers  = c("50m", "100m", "200m", "300m", "400m"),
  digits   = 3,
  se.below = TRUE,
  depvar   = FALSE,
  title    = "SA Threshold Sensitivity: intensity$=1$ (agents + police), $n\\_robos$",
  tex      = TRUE,
  file     = "tables/tab_A2_sa_threshold_sensitivity_int1.tex",
  replace  = TRUE
)

# =============================================================================
# SECTION 15: BALANCE TEST — pre-treatment parallel trends                             ####
# =============================================================================

balance_df <- panel_sa_bim %>%
  group_by(grid_id, bim_idx) %>%
  summarise(n_robos = sum(n_robos), n_hurtos = sum(n_hurtos),
            n_crimes = sum(n_crimes), .groups = "drop") %>%
  left_join(
    cohort_table_bim %>%
      mutate(cohort_label = case_when(
        cohort_bim == COHORT_FASE1 ~ "Fase1 (treated)",
        cohort_bim == COHORT_FASE2 ~ "Fase2 (not-yet-treated)",
        TRUE                       ~ "never-treated"
      )),
    by = "grid_id"
  ) %>%
  filter(cohort_label %in% c("Fase1 (treated)", "Fase2 (not-yet-treated)"),
         bim_idx <= REF_BIM)

balance_means <- balance_df %>%
  group_by(cohort_label, bim_idx) %>%
  summarise(mean_robos  = mean(n_robos),
            mean_hurtos = mean(n_hurtos),
            mean_crimes = mean(n_crimes), .groups = "drop")

for (outcome in c("mean_robos", "mean_hurtos", "mean_crimes")) {
  p <- ggplot(balance_means,
              aes(x = bim_idx, y = .data[[outcome]],
                  color = cohort_label, group = cohort_label)) +
    geom_line() + geom_point(size = 2) +
    scale_x_continuous(breaks = 1:REF_BIM,
                       labels = function(x) sprintf("B%d", x)) +
    labs(title = sprintf("Pre-treatment balance: %s", outcome),
         x     = "Bimestre (pre-treatment only)",
         y     = "Mean count per grid", color = NULL) +
    theme_bw() + theme(legend.position = "bottom")
  print(p)
  ggsave(sprintf("balance_%s.png", outcome), p, width = 8, height = 5, dpi = 300)
}

for (outcome in c("n_robos", "n_hurtos", "n_crimes")) {
  fml   <- as.formula(sprintf("%s ~ cohort_label * factor(bim_idx)", outcome))
  m_bal <- feols(fml, data = balance_df, cluster = ~grid_id)
  cat(sprintf("\n--- Balance test: %s ---\n", outcome))
  int_terms <- grep("cohort_label", names(coef(m_bal)), value = TRUE)
  int_terms <- int_terms[grepl(":", int_terms)]  # solo los términos de interacción
  if (length(int_terms) > 0) {
    cat("Joint F-test cohort x time interactions:\n")
    print(wald(m_bal, int_terms))
  }
}

# =============================================================================
# SECTION 16: SPILLOVER ANALYSIS                                                  ########
# =============================================================================

# --- 16A. SA: Low-dose grids (0 < length_fase1 < DOSE_THRESHOLD) ---
cohort_dose_low <- grid_500 %>%
  st_drop_geometry() %>%
  select(grid_id) %>%
  left_join(dose_fase1,     by = "grid_id") %>%
  left_join(dose_fase2_raw, by = "grid_id") %>%
  mutate(
    length_fase1 = coalesce(length_fase1, 0),
    length_fase2 = coalesce(length_fase2, 0),
    cohort_bim   = case_when(
      length_fase1 > 0 & length_fase1 < DOSE_THRESHOLD ~ COHORT_FASE1,
      length_fase2 > DOSE_THRESHOLD                    ~ COHORT_FASE2,
      TRUE                                             ~ NA_integer_
    )
  )

cat(sprintf(
  "\nDose-low cohort:\n  Low-dose Fase1 (bim %d): %d grids\n  Fase2 control (bim %d): %d grids\n  Excluded: %d\n",
  COHORT_FASE1, sum(cohort_dose_low$cohort_bim == COHORT_FASE1, na.rm = TRUE),
  COHORT_FASE2, sum(cohort_dose_low$cohort_bim == COHORT_FASE2, na.rm = TRUE),
  sum(is.na(cohort_dose_low$cohort_bim))
))

panel_dose_low <- panel_sa_bim %>%
  inner_join(cohort_dose_low %>% filter(!is.na(cohort_bim)), by = "grid_id") %>%
  left_join(grid_covars_sa %>% select(grid_id, n_bus_stops), by = "grid_id") %>%
  mutate(cohort_bim = as.numeric(cohort_bim), bim_idx = as.integer(bim_idx))

stopifnot(sum(is.na(panel_dose_low$cohort_bim))  == 0)
stopifnot(sum(is.na(panel_dose_low$n_bus_stops)) == 0)

for (outcome in c("n_robos", "n_hurtos", "n_crimes")) {
  cat(sprintf("\n=== Dose-low SA | %s ===\n", outcome))
  m_dl_int0 <- run_sa(
    panel_dose_low %>% filter(slot %in% c("control", "school_only")),
    "dose_low intensity=0", outcome
  )
  m_dl_int1 <- run_sa(
    panel_dose_low %>% filter(slot %in% c("double_only", "school_double")),
    "dose_low intensity=1", outcome
  )
  etable(m_dl_int0, m_dl_int1,
         headers = c("intensity=0", "intensity=1"),
         digits  = 3,
         title   = sprintf("SA Dose-low (%s)", outcome))
}

# --- 16B. Displacement : adjacent never-treated grids ---
never_treated_ids <- cohort_table_bim %>%
  filter(is.na(cohort_bim) | cohort_bim == Inf) %>%
  pull(grid_id)

fase1_treated_ids <- cohort_table_bim %>%
  filter(cohort_bim == COHORT_FASE1) %>%
  pull(grid_id)

never_sf <- grid_500 %>% filter(grid_id %in% never_treated_ids)
fase1_sf <- grid_500 %>% filter(grid_id %in% fase1_treated_ids)

adjacent_never <- never_sf %>%
  st_filter(fase1_sf, .predicate = st_touches) %>%
  st_drop_geometry() %>%
  select(grid_id) %>%
  mutate(is_adjacent = 1L)

cat(sprintf(
  "\nDisplacement :\n  Never-treated: %d\n  Adjacent to Fase1: %d\n  Non-adjacent control: %d\n",
  length(never_treated_ids),
  nrow(adjacent_never),
  length(never_treated_ids) - nrow(adjacent_never)
))

panel_disp_bim <- panel_sa_bim %>%
  filter(grid_id %in% never_treated_ids) %>%
  left_join(adjacent_never, by = "grid_id") %>%
  mutate(
    is_adjacent = coalesce(is_adjacent, 0L),
    post        = as.integer(bim_idx >= COHORT_FASE1),
    adj_x_post  = is_adjacent * post,
    bim_idx     = as.integer(bim_idx)
  ) %>%
  left_join(grid_covars_sa %>% select(grid_id, n_bus_stops), by = "grid_id")

stopifnot(sum(is.na(panel_disp_bim$is_adjacent)) == 0)
stopifnot(sum(is.na(panel_disp_bim$n_bus_stops)) == 0)

run_disp <- function(data, label, outcome = "n_robos") {
  cat(sprintf("\n--- Displacement: %s | %s ---\n", label, outcome))
  
  fml <- reformulate(
    termlabels = c(sprintf("i(bim_idx, is_adjacent, ref = %dL)", REF_BIM), "n_bus_stops"),
    response   = outcome,
    env        = parent.frame()
  )
  
  m <- fepois(fml, data = data, fixef = c("grid_id", "bim_idx"), cluster = ~grid_id)
  
  pre  <- grep(sprintf("bim_idx::[1-%d]:is_adjacent", REF_BIM - 1L),
               names(coef(m)), value = TRUE)
  post <- grep("bim_idx::[8-9]:is_adjacent|bim_idx::1[0-9]:is_adjacent|bim_idx::2[0-4]:is_adjacent",
               names(coef(m)), value = TRUE)
  
  if (length(pre)  > 0) { cat("  Pre-trend Wald:"); print(wald(m, pre))  }
  if (length(post) > 0) { cat("  Post Wald:");      print(wald(m, post)) }
  
  cf  <- coef(m); se <- se(m); nm <- names(cf)
  idx <- grep("^bim_idx::", nm)
  bim_vals <- as.integer(sub("^bim_idx::([0-9]+):.*", "\\1", nm[idx]))
  
  df_plot <- data.frame(
    bim_idx = bim_vals,
    est     = unname(cf[idx]),
    lo      = unname(cf[idx]) - 1.96 * unname(se[idx]),
    hi      = unname(cf[idx]) + 1.96 * unname(se[idx])
  ) %>%
    bind_rows(data.frame(bim_idx = REF_BIM, est = 0, lo = 0, hi = 0)) %>%
    arrange(bim_idx)
  
  p <- ggplot(df_plot, aes(x = bim_idx, y = est)) +
    geom_hline(yintercept = 0, linetype = "dashed", color = "gray50") +
    geom_vline(xintercept = REF_BIM + 0.5, linetype = "dashed", color = "steelblue") +
    geom_ribbon(aes(ymin = lo, ymax = hi), alpha = 0.15) +
    geom_line() + geom_point(size = 1.8) +
    scale_x_continuous(breaks = seq(1, 24, by = 2),
                       labels = function(x) sprintf("B%d", x)) +
    labs(title = sprintf("Displacement DiD — %s (%s)", label, outcome),
         x     = sprintf("Bimestre (ref = B%d, Nov-Dic 2016)", REF_BIM),
         y     = "Adjacent vs non-adjacent (Poisson semi-elasticity)") +
    theme_bw()
  print(p)
  ggsave(sprintf("displacement_%s_%s.png", gsub(" ", "_", label), outcome),
         p, width = 10, height = 6, dpi = 300)
  m
}

for (outcome in c("n_robos", "n_hurtos", "n_crimes")) {
  cat(sprintf("\n========== Displacement DiD | %s ==========\n", outcome))
  
  m_disp_int0 <- run_disp(
    panel_disp_bim %>% filter(slot %in% c("control", "school_only")),
    "intensity=0", outcome
  )
  m_disp_int1 <- run_disp(
    panel_disp_bim %>% filter(slot %in% c("double_only", "school_double")),
    "intensity=1", outcome
  )
  etable(m_disp_int0, m_disp_int1,
         headers = c("intensity=0", "intensity=1"),
         digits  = 3,
         title   = sprintf("Displacement DiD: Adjacent Never-Treated (%s)", outcome))
}



# =============================================================================
# SECTION 17: EXPORT — LaTeX TABLES AND PDF PLOTS FOR PAPER                         ####
# =============================================================================
# Naming convention:
#   tab_XX_description.tex  — regression tables
#   fig_XX_description.pdf  — figures (PDF for LaTeX, lossless)
#   fig_XX_description.png  — figures (PNG backup, 300dpi)
# All outputs go to working directory (setwd at top of script).
# =============================================================================

dir.create("output_latex", showWarnings = FALSE)

# ── Helper: save ggplot in both PDF and PNG ───────────────────────────────────
save_fig <- function(p, name, w = 10, h = 6) {
  ggsave(file.path("output_latex", paste0(name, ".pdf")), p, width = w, height = h)
  ggsave(file.path("output_latex", paste0(name, ".png")), p, width = w, height = h, dpi = 300)
  cat(sprintf("  Saved: %s\n", name))
}

# ── TABLE 1: Main SA results by slot (intensity decomposition) ────────────────
etable(
  m_sa_int0, m_sa_int1, m_sa_school, m_sa_nosch,
  headers    = c("Intensity=0", "Intensity=1", "School hrs", "Non-school hrs"),
  digits     = 3,
  se.below   = TRUE,
  depvar     = FALSE,
  title      = "Sun-Abraham: Slot Decomposition (Bimonthly, n\\_robos)",
  notes      = "Poisson PPML. Clustered SE by grid. Cohort = Fase Original (id $\\leq$ 207), threshold 200m. Reference: B6 (Nov-Dic 2016).",
  tex        = TRUE,
  file       = "output_latex/tab_01_sa_main_slots.tex",
  replace    = TRUE
)

# ── TABLE 2: Heterogeneity — sector and poverty ───────────────────────────────
etable(
  m_sa_int1, m_het_sector, m_het_poverty, m_het_full,
  headers    = c("Baseline", "Sector", "Poverty", "Full"),
  keep       = c("pub_x_post", "priv_x_post", "pov_x_post"),
  digits     = 3,
  se.below   = TRUE,
  depvar     = FALSE,
  title      = "SA Heterogeneity: School Sector and Neighborhood Poverty (intensity=1 panel)",
  notes      = "All models include grid\\_id and bim\\_idx fixed effects. pub\\_x\\_post = n\\_pub\\_schools $\\times$ post; priv\\_x\\_post = n\\_priv\\_schools $\\times$ post; pov\\_x\\_post = poverty\\_rate $\\times$ post.",
  tex        = TRUE,
  file       = "output_latex/tab_02_sa_heterogeneity.tex",
  replace    = TRUE
)

# ── TABLE 3: Alternative outcomes (n_crimes, n_hurtos) ───────────────────────
# Re-run quickly to have objects in scope; use last loop results if still live.
# If not: re-run Section 13A loop first, then export.
# Assumes m_int0/m_int1 for n_hurtos are last iteration of the loop.
# For a clean export, save model objects inside the loop:
# (patch: store in named list)
sa_models_by_outcome <- list()
for (outcome in c("n_robos", "n_hurtos", "n_crimes")) {
  sa_models_by_outcome[[outcome]] <- list(
    int0   = run_sa(panel_sa_int0,   "intensity=0",    outcome),
    int1   = run_sa(panel_sa_int1,   "intensity=1",    outcome),
    school = run_sa(panel_sa_school, "school_time=1",  outcome),
    nosch  = run_sa(panel_sa_nosch,  "school_time=0",  outcome)
  )
}

etable(
  sa_models_by_outcome$n_robos$int1,
  sa_models_by_outcome$n_hurtos$int1,
  sa_models_by_outcome$n_crimes$int1,
  headers  = c("Robos", "Hurtos", "All crimes"),
  digits   = 3,
  se.below = TRUE,
  depvar   = FALSE,
  title    = "SA: Alternative Outcomes (intensity=1 panel)",
  tex      = TRUE,
  file     = "output_latex/tab_03_sa_alt_outcomes.tex",
  replace  = TRUE
)

# ── TABLE 4: Displacement DiD ─────────────────────────────────────────────────
# Assumes m_disp_int0 / m_disp_int1 from last iteration of Section 16B loop
# (n_robos). Patch: run once explicitly.
m_disp_robos_int0 <- run_disp(
  panel_disp_bim %>% filter(slot %in% c("control", "school_only")),
  "intensity=0", "n_robos"
)
m_disp_robos_int1 <- run_disp(
  panel_disp_bim %>% filter(slot %in% c("double_only", "school_double")),
  "intensity=1", "n_robos"
)

etable(
  m_disp_robos_int0, m_disp_robos_int1,
  headers  = c("Intensity=0", "Intensity=1"),
  digits   = 3,
  se.below = TRUE,
  depvar   = FALSE,
  title    = "Displacement: Adjacent Never-Treated Grids (n\\_robos)",
  notes    = "Treatment = adjacent to Fase1 grid. Post = bim\\_idx $\\geq$ 8. Grid and bimestre FE.",
  tex      = TRUE,
  file     = "output_latex/tab_04_displacement_did.tex",
  replace  = TRUE
)

# ── FIGURE 1: Main SA — intensity comparison ──────────────────────────────────
p_fig1 <- ggplot(df_int_compare, aes(x = bim_idx, y = est, color = label, fill = label)) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "gray50") +
  geom_vline(xintercept = REF_BIM + 0.5, linetype = "dashed", color = "steelblue") +
  geom_ribbon(aes(ymin = lo, ymax = hi), alpha = 0.12, color = NA) +
  geom_line() + geom_point(size = 1.8) +
  scale_x_continuous(breaks = seq(1, 24, by = 2),
                     labels = function(x) sprintf("B%d", x)) +
  scale_color_manual(values = c("intensity=0" = "#D55E00", "intensity=1" = "#0072B2"),
                     labels = c("Intensity = 0 (agents only)", "Intensity = 1 (agents + police)")) +
  scale_fill_manual(values  = c("intensity=0" = "#D55E00", "intensity=1" = "#0072B2"),
                    labels  = c("Intensity = 0 (agents only)", "Intensity = 1 (agents + police)")) +
  labs(
    title  = NULL,
    x      = sprintf("Bimonthly period (ref = B%d, Nov–Dec 2016)", REF_BIM),
    y      = "ATT (Poisson semi-elasticity)",
    color  = NULL, fill = NULL
  ) +
  theme_bw(base_size = 11) +
  theme(legend.position = "bottom",
        panel.grid.minor = element_blank())

save_fig(p_fig1, "fig_01_sa_intensity_compare")

# ── FIGURE 2: SA school vs non-school hours ───────────────────────────────────
p_fig2 <- ggplot(df_school_compare, aes(x = bim_idx, y = est, color = label, fill = label)) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "gray50") +
  geom_vline(xintercept = REF_BIM + 0.5, linetype = "dashed", color = "steelblue") +
  geom_ribbon(aes(ymin = lo, ymax = hi), alpha = 0.12, color = NA) +
  geom_line() + geom_point(size = 1.8) +
  scale_x_continuous(breaks = seq(1, 24, by = 2),
                     labels = function(x) sprintf("B%d", x)) +
  scale_color_manual(values = c("school_time=1" = "#009E73", "school_time=0" = "#CC79A7"),
                     labels = c("School transition hours", "Non-transition hours")) +
  scale_fill_manual(values  = c("school_time=1" = "#009E73", "school_time=0" = "#CC79A7"),
                    labels  = c("School transition hours", "Non-transition hours")) +
  labs(
    title = NULL,
    x     = sprintf("Bimonthly period (ref = B%d, Nov–Dec 2016)", REF_BIM),
    y     = "ATT (Poisson semi-elasticity)",
    color = NULL, fill = NULL
  ) +
  theme_bw(base_size = 11) +
  theme(legend.position = "bottom",
        panel.grid.minor = element_blank())

save_fig(p_fig2, "fig_02_sa_school_vs_nonschool")

# ── FIGURE 3: Balance — pre-treatment trends ──────────────────────────────────
p_fig3 <- ggplot(balance_means,
                 aes(x = bim_idx, y = mean_robos,
                     color = cohort_label, group = cohort_label)) +
  geom_line(size = 0.8) + geom_point(size = 2.2) +
  scale_x_continuous(breaks = 1:REF_BIM,
                     labels = function(x) sprintf("B%d", x)) +
  scale_color_manual(values = c("Fase1 (treated)"         = "#0072B2",
                                "Fase2 (not-yet-treated)" = "#D55E00"),
                     labels = c("Fase 1 (treated Mar 2017)",
                                "Fase 2 (control group)")) +
  labs(
    title = NULL,
    x     = "Bimonthly period (pre-treatment only)",
    y     = "Mean robberies per grid cell",
    color = NULL
  ) +
  theme_bw(base_size = 11) +
  theme(legend.position = "bottom",
        panel.grid.minor = element_blank())

save_fig(p_fig3, "fig_03_balance_pretrend", w = 8, h = 5)


# ── FIGURE 4: Entry vs Exit slots (n_robos) ───────────────────────────────────
# Rebuild from last loop iteration — n_robos
# Bimestres enero-febrero de cada año (bim_idx 1, 7, 13, 19)
bim_excluir <- c(1, 7, 13, 19)

panel_entry  <- panel_entry  %>% filter(!bim_idx %in% bim_excluir)
panel_exit_p <- panel_exit_p %>% filter(!bim_idx %in% bim_excluir)
panel_exit_s <- panel_exit_s %>% filter(!bim_idx %in% bim_excluir)

m_entry_rob  <- run_sa(panel_entry,  "entry (7-8h)",              "n_robos")
m_exit_p_rob <- run_sa(panel_exit_p, "exit primaria (12h)",       "n_robos")
m_exit_s_rob <- run_sa(panel_exit_s, "exit secundaria (16-17h)",  "n_robos")

# --- DIAGNOSTIC (mover acá, después de run_sa) ---
panel_entry %>% 
  group_by(bim_idx) %>% 
  summarise(n = n(), n_grids = n_distinct(grid_id)) %>% 
  print(n = 30)

coeftable(m_entry_rob) %>%      # <-- ahora sí existe
  as.data.frame() %>% 
  filter(abs(Estimate) > 2)

panel_entry %>%
  mutate(treated = as.integer(length_fase1 > 200)) %>%
  group_by(bim_idx, treated) %>%
  summarise(total_robos = sum(n_robos), .groups = "drop") %>%
  filter(treated == 1) %>%
  print(n = 30)

df_ex_rob <- bind_rows(
  extract_sa_coefs(m_entry_rob,  "Entry (7–8h)"),
  extract_sa_coefs(m_exit_p_rob, "Exit primary (12h)"),
  extract_sa_coefs(m_exit_s_rob, "Exit secondary (16–17h)")
) %>%
  bind_rows(data.frame(
    bim_idx = rep(REF_BIM, 3), est = 0, lo = 0, hi = 0,
    label   = c("Entry (7–8h)", "Exit primary (12h)", "Exit secondary (16–17h)")
  )) %>%
  arrange(label, bim_idx)

p_fig4 <- ggplot(df_ex_rob, aes(x = bim_idx, y = est, color = label, fill = label)) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "gray50") +
  geom_vline(xintercept = REF_BIM + 0.5, linetype = "dashed", color = "steelblue") +
  geom_ribbon(aes(ymin = lo, ymax = hi), alpha = 0.10, color = NA) +
  geom_line() + geom_point(size = 1.8) +
  scale_x_continuous(breaks = seq(1, 24, by = 2),
                     labels = function(x) sprintf("B%d", x)) +
  scale_color_manual(values = c("Entry (7–8h)"            = "#0072B2",
                                "Exit primary (12h)"      = "#D55E00",
                                "Exit secondary (16–17h)" = "#009E73")) +
  scale_fill_manual(values  = c("Entry (7–8h)"            = "#0072B2",
                                "Exit primary (12h)"      = "#D55E00",
                                "Exit secondary (16–17h)" = "#009E73")) +
  labs(
    title = NULL,
    x     = sprintf("Bimonthly period (ref = B%d, Nov–Dec 2016)", REF_BIM),
    y     = "Poisson semi-elasticity",
    color = NULL, fill = NULL
  ) +
  theme_bw(base_size = 11) +
  theme(legend.position = "bottom",
        panel.grid.minor = element_blank())

save_fig(p_fig4, "fig_04_sa_entry_exit_robos")

# ── APPENDIX TABLE A1: Dose threshold sensitivity ─────────────────────────────
# Collect models across thresholds — run loop storing results
thresh_models <- list()
for (thresh in c(50L, 100L, 200L, 300L, 400L)) {
  ct <- cohort_table_bim %>%
    mutate(cohort_bim = case_when(
      length_fase1 > thresh ~ COHORT_FASE1,
      length_fase2 > thresh ~ COHORT_FASE2,
      TRUE                  ~ NA_integer_
    ))
  panel_t <- panel_sa_bim %>%
    inner_join(ct %>% filter(!is.na(cohort_bim)), by = "grid_id") %>%
    left_join(grid_covars_sa %>% select(grid_id, n_bus_stops), by = "grid_id") %>%
    filter(slot %in% c("double_only", "school_double")) %>%
    mutate(cohort_bim = as.numeric(cohort_bim), bim_idx = as.integer(bim_idx))
  # Bimestres Jan-Feb: 0 due to school vacation
  # bim_idx 1  = Jan-Feb 2016
  # bim_idx 7  = Jan-Feb 2017
  # bim_idx 13 = Jan-Feb 2018
  # bim_idx 19 = Jan-Feb 2019
  BIMS_HOLIDAY <- c(1L, 7L, 13L, 19L)
  
  panel_sa_bim <- panel_sa_bim %>%
    filter(!bim_idx %in% BIMS_HOLIDAY)
  thresh_models[[as.character(thresh)]] <- fepois(
    reformulate(c("sunab(cohort_bim, bim_idx)", "n_bus_stops"),
                response = "n_robos", env = parent.frame()),
    data = panel_t, cluster = ~grid_id
  )
}

etable(
  thresh_models[["50"]], thresh_models[["100"]], thresh_models[["200"]],
  thresh_models[["300"]], thresh_models[["400"]],
  headers  = c("50m", "100m", "200m", "300m", "400m"),
  digits   = 3,
  se.below = TRUE,
  depvar   = FALSE,
  title    = "Appendix: SA Sensitivity to Dose Threshold (intensity=1, n\\_robos)",
  tex      = TRUE,
  file     = "output_latex/tab_A1_sa_threshold_sensitivity.tex",
  replace  = TRUE
)

cat("\n=== Export complete — files in ./output_latex/ ===\n")
cat("Tables : tab_01 main slots | tab_02 heterogeneity | tab_03 alt outcomes | tab_04 displacement | tab_A1 thresholds\n")
cat("Figures: fig_01 intensity | fig_02 school hrs | fig_03 balance | fig_04 entry-exit\n")





for (outcome in c("n_robos", "n_hurtos", "n_crimes")) {
  fml   <- as.formula(sprintf("%s ~ cohort_label * factor(bim_idx)", outcome))
  m_bal <- feols(fml, data = balance_df, cluster = ~grid_id)
  int_terms <- grep("cohort_label.*:", names(coef(m_bal)), value = TRUE)
  cat(sprintf("\n--- Balance test: %s ---\n", outcome))
  print(wald(m_bal, int_terms))
}



# SCRIPT: PLACEBO TEST — NIGHT HOURS (Senderos Escolares)
# =============================================================================
# Logic: Senderos operate only during school transition hours (6-19h on weekdays).
#        If the programme effect is causal and operates through student-flow
#        guardianship, it should be ZERO during night hours (20-23h / 0-5h),
#        when there is no school activity and no agent deployment.
#        A significant post-treatment coefficient in the night panel would
#        indicate pre-existing trends or unobserved confounders — falsifying
#        the identifying assumption.
#
# Inputs (must be in environment or working directory):
#   crimes_raw         : delitos_sf_with_grid500.rds
#   grid_500           : grid_enriched_500.rds  (sf)
#   sendero_dose       : built in last_event_study.R Section 4C
#   cohort_table_bim   : built in last_event_study.R Section 9C
#   grid_covars_sa     : built in last_event_study.R Section 9D
#   DOSE_THRESHOLD, REF_BIM, COHORT_FASE1, COHORT_FASE2, BIMS_HOLIDAY : constants
#
# All objects above are available if last_event_study.R Sections 1-9 have run.
# =============================================================================

library(dplyr)
library(lubridate)
library(tidyr)
library(fixest)
library(ggplot2)

# ---------------------------------------------------------------------------
# 0. Constants (must match last_event_study.R)
# ---------------------------------------------------------------------------

NIGHT_HOURS <- c(20L, 21L, 22L, 23L, 0L, 1L, 2L, 3L, 4L, 5L)

# Re-use constants already defined in the main script:
stopifnot(exists("DOSE_THRESHOLD"), exists("REF_BIM"),
          exists("COHORT_FASE1"),   exists("COHORT_FASE2"),
          exists("BIMS_HOLIDAY"),   exists("cohort_table_bim"),
          exists("grid_covars_sa"), exists("grid_500"))

# ---------------------------------------------------------------------------
# 1. Filter crimes to NIGHT hours, weekdays, 2016-2019 (excl. Jan-Feb)
# ---------------------------------------------------------------------------

crimes_night_raw <- crimes_raw %>%
  { if ("grid_id" %in% colnames(.)) select(., -grid_id) else . } %>%
  sf::st_transform(32721) %>%
  mutate(
    fecha_dt   = as.Date(Fecha),
    dow        = lubridate::wday(fecha_dt),
    year       = lubridate::year(fecha_dt),
    month_year = lubridate::floor_date(fecha_dt, "month"),
    hora_num   = as.integer(as.character(`Franja Horaria`))
  ) %>%
  filter(
    Tipo %in% c("Robo", "Hurto", "Robo automotor",
                "Hurto automotor", "Lesiones Dolosas"),
    year >= 2016L, year <= 2019L,
    !lubridate::month(fecha_dt) %in% c(1L, 2L),
    dow %in% 2:6,          # weekdays only — same sample frame as main analysis
    hora_num %in% NIGHT_HOURS
  )

cat(sprintf("Night crimes (weekday, Mar-Dec, 2016-2019): %d records\n",
            nrow(crimes_night_raw)))

# ---------------------------------------------------------------------------
# 2. Spatial join to grid
# ---------------------------------------------------------------------------

crimes_night_joined <- sf::st_join(
  crimes_night_raw,
  grid_500 %>% select(grid_id),
  join = sf::st_within
) %>%
  {
    missing <- filter(., is.na(grid_id))
    present <- filter(., !is.na(grid_id))
    if (nrow(missing) > 0) {
      idx <- sf::st_nearest_feature(missing, grid_500)
      missing$grid_id <- grid_500$grid_id[idx]
    }
    bind_rows(present, missing)
  } %>%
  sf::st_drop_geometry() %>%
  filter(!is.na(grid_id)) %>%
  mutate(
    is_robo  = as.integer(Tipo == "Robo"),
    is_hurto = as.integer(Tipo == "Hurto")
  )

# ---------------------------------------------------------------------------
# 3. Aggregate to grid x month
# ---------------------------------------------------------------------------

agg_night <- crimes_night_joined %>%
  group_by(grid_id, month_year) %>%
  summarise(
    n_robos  = sum(is_robo),
    n_hurtos = sum(is_hurto),
    n_crimes = n(),
    .groups  = "drop"
  )

# ---------------------------------------------------------------------------
# 4. Build balanced monthly skeleton
# ---------------------------------------------------------------------------

months_vec <- seq(as.Date("2016-01-01"), as.Date("2019-12-01"), by = "month")

skeleton_night <- expand_grid(
  grid_id    = grid_500$grid_id,
  month_year = months_vec
)

panel_night_monthly <- skeleton_night %>%
  left_join(agg_night, by = c("grid_id", "month_year")) %>%
  mutate(
    across(c(n_robos, n_hurtos, n_crimes), ~ coalesce(.x, 0L)),
    month_idx = as.integer(
      lubridate::interval(as.Date("2016-01-01"), month_year) %/% months(1)
    ) + 1L,
    bim_idx = ceiling(month_idx / 2L)
  )

stopifnot(nrow(panel_night_monthly) ==
            n_distinct(grid_500$grid_id) * length(months_vec))

# ---------------------------------------------------------------------------
# 5. Collapse to bimestre
# ---------------------------------------------------------------------------

panel_night_bim <- panel_night_monthly %>%
  group_by(grid_id, bim_idx) %>%
  summarise(
    n_robos  = sum(n_robos),
    n_hurtos = sum(n_hurtos),
    n_crimes = sum(n_crimes),
    .groups  = "drop"
  ) %>%
  mutate(bim_idx = as.integer(bim_idx))

# ---------------------------------------------------------------------------
# 6. Attach cohort assignment, covariates — same as main panel
# ---------------------------------------------------------------------------

panel_night_sa <- panel_night_bim %>%
  inner_join(
    cohort_table_bim %>% filter(!is.na(cohort_bim)),
    by = "grid_id"
  ) %>%
  left_join(grid_covars_sa, by = "grid_id") %>%
  filter(!bim_idx %in% BIMS_HOLIDAY) %>%
  mutate(
    cohort_bim   = as.numeric(cohort_bim),
    bim_idx      = as.integer(bim_idx),
    poverty_rate = coalesce(poverty_rate, 0),
    across(c(n_schools, n_pub_schools, n_priv_schools,
             n_bus_stops, pct_commercial, pct_gastronomy), ~ coalesce(.x, 0))
  )

stopifnot(sum(is.na(panel_night_sa$cohort_bim)) == 0)
stopifnot(sum(is.na(panel_night_sa$n_bus_stops)) == 0)

cat(sprintf("panel_night_sa: %d rows | %d grids | bim %d-%d\n",
            nrow(panel_night_sa),
            n_distinct(panel_night_sa$grid_id),
            min(panel_night_sa$bim_idx),
            max(panel_night_sa$bim_idx)))

# ---------------------------------------------------------------------------
# 7. Sun-Abraham placebo model
# ---------------------------------------------------------------------------
# Identical spec to the baseline intensity=0 model in last_event_study.R
# (Section 11). If the programme effect is zero at night, pre- and
# post-treatment coefficients should be jointly indistinguishable from zero.

m_placebo_night <- fepois(
  n_robos ~ sunab(cohort_bim, bim_idx) + n_bus_stops | grid_id + bim_idx,
  data    = panel_night_sa,
  cluster = ~grid_id
)

summary(m_placebo_night, agg = "att")

# Pre-trend bimestres: 2-5 (Mar 2016 - Oct 2016)
pre_terms <- grep("bim_idx::[2-5]$", names(coef(m_placebo_night)), value = TRUE)
# Post-treatment bimestres: 8-24 (Mar 2017 - Dec 2019)
post_terms <- grep(
  "bim_idx::[8-9]$|bim_idx::1[0-9]$|bim_idx::2[0-4]$",
  names(coef(m_placebo_night)), value = TRUE
)

cat("\n--- Placebo night: pre-trend Wald ---\n")
if (length(pre_terms) > 0)  print(wald(m_placebo_night, pre_terms))

cat("\n--- Placebo night: post-treatment Wald ---\n")
if (length(post_terms) > 0) print(wald(m_placebo_night, post_terms))

# ---------------------------------------------------------------------------
# 8. Event-study plot
# ---------------------------------------------------------------------------

iplot(
  m_placebo_night,
  main     = "Placebo: Night Hours (20h-5h) — No Agent Deployment",
  xlab     = "Bimestre relative to treatment (b=6 reference)",
  ylab     = "SA ATT coefficient",
  sub      = "Senderos Escolares, intensity=0 panel. 95% CI clustered by grid.",
  ref.line = TRUE
)

# Publication-quality ggplot version
coef_df <- as.data.frame(coeftable(m_placebo_night)) %>%
  tibble::rownames_to_column("term") %>%
  filter(grepl("bim_idx", term)) %>%
  mutate(
    bim     = as.integer(gsub(".*::(\\d+).*", "\\1", term)),  # regex más robusto
    ci_lo   = Estimate - 1.96 * `Std. Error`,
    ci_hi   = Estimate + 1.96 * `Std. Error`,
    rel_bim = bim - REF_BIM
  ) %>%
  filter(!is.na(bim), !bim %in% BIMS_HOLIDAY) %>%  # filtrar NAs antes del plot
  arrange(bim)

# Add the reference bimestre row at zero
ref_row <- data.frame(
  term = "ref", bim = REF_BIM, Estimate = 0, `Std. Error` = 0,
  ci_lo = 0, ci_hi = 0, rel_bim = 0,
  check.names = FALSE
)
coef_df <- bind_rows(coef_df, ref_row) %>% arrange(bim)

p_placebo <- ggplot(coef_df, aes(x = rel_bim, y = Estimate)) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "grey50") +
  geom_vline(xintercept = 0, linetype = "dotted", color = "steelblue") +
  geom_ribbon(aes(ymin = ci_lo, ymax = ci_hi), alpha = 0.15, fill = "tomato") +
  geom_line(color = "tomato", linewidth = 0.8) +
  geom_point(color = "tomato", size = 1.8) +
  annotate("text", x = 0.3, y = max(coef_df$ci_hi, na.rm = TRUE) * 0.9,
           label = "Treatment\n(b=8)", hjust = 0, size = 3, color = "steelblue") +
  scale_x_continuous(
    breaks = seq(min(coef_df$rel_bim, na.rm = TRUE), 
                 max(coef_df$rel_bim, na.rm = TRUE), by = 2)
  ) +
  labs(
    title    = "Placebo test: Night hours (20h\u201305h)",
    subtitle = "No Senderos agents deployed. Significant post coefficients would falsify identification.",
    x        = "Bimestre relative to treatment (b = 6 reference)",
    y        = "Sun\u2013Abraham ATT coefficient",
    caption  = "Poisson QMLE. Grid and bimestre FE. Cluster SE by grid. Outcome: n_robos."
  ) +
  theme_minimal(base_size = 11) +
  theme(
    plot.title    = element_text(face = "bold"),
    plot.subtitle = element_text(size = 9, color = "grey40"),
    panel.grid.minor = element_blank()
  )

print(p_placebo)

# Save
ggsave("plots/placebo_night_senderos.png", p_placebo,
       width = 7, height = 4, dpi = 300, bg = "white")

cat("Saved: plots/placebo_night_senderos.png\n")

# ---------------------------------------------------------------------------
# 9. Summary table for LaTeX — extract key statistics
# ---------------------------------------------------------------------------
# Run this block after the model to get numbers for the LaTeX paragraph.

wald_pre  <- wald(m_placebo_night, pre_terms)
wald_post <- wald(m_placebo_night, post_terms)

att_agg <- aggregate(m_placebo_night, agg = "att")

cat(sprintf("\n=== PLACEBO SUMMARY (copy to LaTeX) ===\n"))
cat(sprintf("Pre-trend  Wald: F = %.2f, p = %.3f\n",
            wald_pre$stat,  wald_pre$p))
cat(sprintf("Post-treat Wald: F = %.2f, p = %.3f\n",
            wald_post$stat, wald_post$p))
cat("(Expected: post F not significant, ATT near zero)\n")

# ---------------------------------------------------------------------------
# 10. Etable for appendix
# ---------------------------------------------------------------------------

etable(
  m_placebo_night,
  title   = "Placebo test: night hours (20h--5h)",
  notes   = paste(
    "Poisson QMLE. Sun-Abraham estimator.",
    "Night hours (20h--5h) on weekdays, 2016--2019.",
    "Grid and bimestre FE. Cluster SE by grid.",
    "Outcome: n\\_robos. Senderos agents not deployed during these hours.",
    "A significant post-treatment coefficient would falsify the",
    "identifying assumption of the guardianship channel."
  ),
  tex  = TRUE,
  file = "tables/tab_placebo_night.tex"
)

cat("Saved: tables/tab_placebo_night.tex\n")
cat("=== placebo_nocturno.R complete ===\n")
cat("\n=== Script 05 complete ===\n")


# Verificar baseline pre-treatment: 2.05 robberies per grid per bimestre
# Panel: intensity=0, Fase Original grids, bimestres 2-6 (pre-treatment)

panel_sa_int0 %>%
  filter(
    cohort_bim == COHORT_FASE1,
    bim_idx %in% 2:6,
    length_fase1 > DOSE_THRESHOLD
  ) %>%
  summarise(
    mean_robos   = mean(n_robos, na.rm = TRUE),
    median_robos = median(n_robos, na.rm = TRUE),
    sd_robos     = sd(n_robos, na.rm = TRUE)
  )
# debe dar mean ≈ 2.05, median ≈ 1, SD ≈ 2.42 (citado en tesis footnote 2)
colnames(panel_sa_int0)
