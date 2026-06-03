# =============================================================================
# SCRIPT: SUMMARY STATISTICS & DESCRIPTIVE ANALYSIS
# Paper: Micro-Place: School Density, Student Flows, and Street Crime in CABA
# =============================================================================
# Sections:
#   0. Setup & Data Loading
#   1. Global Crime Statistics (all years)
#   2. Time Distribution (hour of day, day of week, monthly trend)
#   3. Grid-Level Crime Distribution & Overdispersion
#   4. School Distribution & Spatial Characteristics
#   5. Census Variables (poverty, population)
#   6. Baseline Crime by Franja & Distance Bin (anchors regression coefficients)
#   7. Senderos Escolares Pre-Treatment Baseline
#   8. Summary Table Inputs (Table 1 in paper)
# =============================================================================


# =============================================================================
# SECTION 0: SETUP & DATA LOADING
# =============================================================================

setwd("C:/Franco/Univ/Bachelorarbeit/Hiroshi")  ## <---- Edit path    # <-- EDIT PATH

library(dplyr)
library(tidyr)
library(lubridate)
library(ggplot2)
library(sf)
library(readr)
library(readxl)
library(units)
library(KernSmooth)
library(raster)
library(leaflet)
library(htmlwidgets)

select <- dplyr::select

# ── Raw inputs ────────────────────────────────────────────────────────────────
crimes_sf_all      <- readRDS("delitos_sf_with_grid500.rds")          # all years, all crimes
schools_raw        <- read_excel("schools_with_coordinates.xlsx")      # school geocoded
radio_censal       <- read.csv("informacion-censal-por-radio-2010.csv")

# ── Processed panels ──────────────────────────────────────────────────────────
crime_panel_final  <- readRDS("crime_panel_final_2016.rds")           # 907 x 211 x 4 (weekdays only)
schools_clean      <- readRDS("clean_schools.rds")                     # school-level sf

# ── Event study panels ────────────────────────────────────────────────────────                   # SA panel, intensity = 0
senderos_raw       <- read.csv("senderos_full.csv")                    # Senderos raw geometries

# ── Cohort table (for treated grid counts) ────────────────────────────────────
#cohort_table_bim   <- readRDS("cohort_table_bim.rds")                 # bim_idx + cohort_bim


# =============================================================================
# SECTION 1: GLOBAL CRIME STATISTICS (all years)
# =============================================================================

cat("\n=== GLOBAL CRIME STATISTICS ===\n")
cat("Total crime records:", nrow(crimes_sf_all), "\n")
cat("Years covered:", min(crimes_sf_all$year), "–", max(crimes_sf_all$year), "\n")
cat("Unique grids with crimes:", n_distinct(crimes_sf_all$grid_id), "\n")


# =============================================================================
# SECTION 2: TIME DISTRIBUTION
# =============================================================================

# ── 2a. Hour of day ───────────────────────────────────────────────────────────

crimes_hour_plot <- crimes_sf_all %>%
  st_drop_geometry() %>%
  filter(!is.na(`Franja Horaria`)) %>%
  mutate(hour = as.numeric(`Franja Horaria`)) %>%
  group_by(hour) %>%
  summarise(n = n(), .groups = "drop") %>%
  mutate(pct = 100 * n / sum(n)) %>%
  arrange(hour)

# Plot used in Figure 1 of paper
ggplot(crimes_hour_plot, aes(x = hour, y = pct)) +
  geom_line() +
  geom_point() +
  geom_text(
    data = crimes_hour_plot %>% filter(pct > 5),
    aes(label = round(pct, 1)),
    vjust = -0.5, size = 3.5
  ) +
  scale_x_continuous(breaks = seq(0, 23, by = 2)) +
  labs(
    x     = "Hour of the day",
    y     = "Percentage of crimes (%)",
    title = "Distribution of Crime by Hour of the Day"
  ) +
  theme_minimal() +
  theme(plot.title = element_text(hjust = 0.5))

# ── 2b. Day of week ───────────────────────────────────────────────────────────

crimes_dow_plot <- crimes_sf_all %>%
  st_drop_geometry() %>%
  filter(!is.na(dow_lab)) %>%
  count(dow_lab) %>%
  mutate(
    pct     = 100 * n / sum(n),
    dow_lab = factor(dow_lab, levels = c("Mo","Di","Mi","Do","Fr","Sa","So"))
  )

# Plot used in Figure 3 of paper
ggplot(crimes_dow_plot, aes(x = dow_lab, y = pct)) +
  geom_bar(stat = "identity") +
  geom_text(aes(label = round(pct, 1)), vjust = -0.3, size = 4) +
  labs(
    x     = "Day of the week",
    y     = "Percentage of crimes (%)",
    title = "Distribution of Crime by Day of the Week"
  ) +
  theme_minimal()

# ── 2c. Monthly trend (all years — Figure 4) ──────────────────────────────────

crimes_month <- crimes_sf_all %>%
  st_drop_geometry() %>%
  group_by(ym) %>%
  summarise(n = n(), .groups = "drop") %>%
  mutate(ym_date = as.Date(paste0(ym, "-01")))

cat("\n=== MONTHLY CRIME TREND ===\n")
cat("Mean monthly crimes:", round(mean(crimes_month$n), 1), "\n")
cat("SD:", round(sd(crimes_month$n), 1), "\n")

ggplot(crimes_month, aes(ym_date, n)) +
  geom_line(color = "blue") +
  labs(x = "Month", y = "Crimes", title = "Monthly Crime Trend") +
  theme_minimal()

# ── 2d. Daily distribution ────────────────────────────────────────────────────

crimes_daily <- crimes_sf_all %>%
  st_drop_geometry() %>%
  group_by(Fecha) %>%
  summarise(n = n(), .groups = "drop")

cat("\n=== DAILY CRIME DISTRIBUTION ===\n")
cat("Mean crimes per day:", round(mean(crimes_daily$n), 2), "\n")
cat("Median:", median(crimes_daily$n), "\n")
cat("SD:", round(sd(crimes_daily$n), 2), "\n")
print(quantile(crimes_daily$n, probs = c(0.10, 0.25, 0.75, 0.90)))


# =============================================================================
# SECTION 3: GRID-LEVEL CRIME DISTRIBUTION & OVERDISPERSION
# =============================================================================

# Annual crimes per grid (all offense types, all years)
crimes_grid <- crimes_sf_all %>%
  st_drop_geometry() %>%
  group_by(grid_id) %>%
  summarise(n = n(), .groups = "drop")

cat("\n=== CRIMES PER GRID (all years, all offenses) ===\n")
print(summary(crimes_grid$n))
cat("Top 1% threshold:", quantile(crimes_grid$n, 0.99), "\n")

# Overdispersion: Poisson requires variance ≈ mean; ratio >> 1 justifies fepois
mean_cr <- mean(crimes_grid$n)
var_cr  <- var(crimes_grid$n)
cat("\n=== OVERDISPERSION CHECK ===\n")
cat("Mean:", round(mean_cr, 2), "\n")
cat("Variance:", round(var_cr, 2), "\n")
cat("Variance/Mean ratio:", round(var_cr / mean_cr, 2),
    "— ratio >> 1 confirms overdispersion, motivating Poisson QMLE\n")

# 2016 panel: robberies + thefts per grid
cat("\n=== 2016 PANEL: ROBBERIES + THEFTS PER GRID (annual) ===\n")
crime_panel_final %>%
  filter(weekdays(date) %in% c("Montag","Dienstag","Mittwoch","Donnerstag","Freitag")) %>%
  group_by(grid_id) %>%
  summarise(annual = sum(n_robos + n_hurtos), .groups = "drop") %>%
  summarise(
    mean   = round(mean(annual), 1),
    sd     = round(sd(annual), 1),
    median = median(annual),
    max    = max(annual)
  ) %>%
  print()

# =============================================================================
# SECTION 4: SCHOOL DISTRIBUTION & SPATIAL CHARACTERISTICS
# =============================================================================

# Rebuild schools_clean from schools_raw to ensure sector/level columns are present
# (the saved .rds collapses to grid level and loses school-level attributes)
schools_clean <- schools_raw %>%
  filter(!is.na(latitude), !is.na(longitude)) %>%
  st_as_sf(coords = c("longitude", "latitude"), crs = 4326, remove = FALSE) %>%
  st_transform(22174)

cat("\n=== SCHOOL COUNTS PER GRID ===\n")
crime_panel_final %>%
  distinct(grid_id, n_schools, n_pub_schools, n_priv_schools) %>%
  summarise(
    mean_schools = round(mean(n_schools, na.rm = TRUE), 2),
    max_schools  = max(n_schools, na.rm = TRUE),
    pct_zero     = round(mean(n_schools == 0, na.rm = TRUE) * 100, 1),
    pct_one_plus = round(mean(n_schools > 0,  na.rm = TRUE) * 100, 1)
  ) %>% print()

cat("\n=== SCHOOL SECTOR × LEVEL ===\n")
schools_clean %>%
  st_drop_geometry() %>%
  summarise(
    n_total    = n(),
    n_pub      = sum(sector == "Estatal",  na.rm = TRUE),
    n_priv     = sum(sector == "Privado",  na.rm = TRUE),
    n_primaria = sum(is_primario == 1,     na.rm = TRUE),
    n_secund   = sum(is_secundario == 1,   na.rm = TRUE)
  ) %>% print()

schools_clean %>%
  st_drop_geometry() %>%
  mutate(level = case_when(
    is_primario   == 1 ~ "Primary",
    is_secundario == 1 ~ "Secondary",
    TRUE               ~ "Other"
  )) %>%
  filter(level != "Other") %>%
  count(sector, level) %>%
  pivot_wider(names_from = level, values_from = n, values_fill = 0) %>%
  mutate(Total = Primary + Secondary) %>%
  print()

cat("\n=== DISTANCE TO NEAREST SCHOOL (grid centroids) ===\n")
crime_panel_final %>%
  distinct(grid_id, dist_nearest_school) %>%
  summarise(
    mean            = round(mean(dist_nearest_school,   na.rm = TRUE), 0),
    sd              = round(sd(dist_nearest_school,     na.rm = TRUE), 0),
    median          = round(median(dist_nearest_school, na.rm = TRUE), 0),
    max             = round(max(dist_nearest_school,    na.rm = TRUE), 0),
    pct_within_500m = round(mean(dist_nearest_school < 500, na.rm = TRUE) * 100, 1)
  ) %>% print()

cat("\n=== SCHOOL NEAREST-NEIGHBOUR SPACING ===\n")
schools_nn <- schools_raw %>%
  filter(!is.na(latitude), !is.na(longitude)) %>%
  st_as_sf(coords = c("longitude", "latitude"), crs = 4326) %>%
  st_transform(22174)

dist_nn    <- st_distance(schools_nn)
diag(dist_nn) <- NA
nn_m       <- apply(dist_nn, 1, min, na.rm = TRUE)

cat("Mean NN distance:",                round(mean(nn_m),   0), "m\n")
cat("Median:",                          round(median(nn_m), 0), "m\n")
cat("Min:",                             round(min(nn_m),    0), "m\n")
cat("Max:",                             round(max(nn_m),    0), "m\n")
cat("% schools within 500m of another:", round(mean(nn_m < 500) * 100, 1), "%\n")
# School KDE heatmap
schools_clean_map <- schools_raw %>% filter(!is.na(latitude), !is.na(longitude))
kde <- bkde2D(cbind(schools_clean_map$longitude, schools_clean_map$latitude),
              bandwidth = c(0.008, 0.008), gridsize = c(200, 200))
kde_raster <- raster(list(x = kde$x1, y = kde$x2, z = t(kde$fhat)),
                     crs = CRS("+proj=longlat +datum=WGS84"))
pal_heat <- colorNumeric(
  palette  = c("transparent", "#FFEB3B", "#FF5722", "#B71C1C"),
  domain   = values(kde_raster), na.color = "transparent"
)
mapa <- leaflet() %>%
  addProviderTiles(providers$CartoDB.Positron) %>%
  addRasterImage(kde_raster, colors = pal_heat, opacity = 0.6)
mapa
saveWidget(mapa, "mapa_escuelas_CABA.html", selfcontained = TRUE)


library(leaflet)
library(dplyr)

library(leaflet)
library(dplyr)

schools_map <- schools_raw %>%
  filter(!is.na(latitude), !is.na(longitude)) %>%
  mutate(
    nivel = case_when(
      is_primario   == 1 ~ "Primary",
      is_secundario == 1 ~ "Secondary",
      is_tecnico    == 1 ~ "Technical",
      TRUE               ~ "Other"
    ),
    sector_label = case_when(
      sector == "Estatal" ~ "Public",
      sector == "Privado" ~ "Private",
      TRUE                ~ sector
    ),
    popup_text = paste0(
      "<b>", nombre, "</b><br>",
      "Sector: ",  sector_label, "<br>",
      "Level: ",   nivel, "<br>",
      "Address: ", domicilio
    )
  )

leaflet(schools_map) %>%
  addProviderTiles(providers$CartoDB.Positron) %>%
  
  addCircleMarkers(
    data = schools_map %>% filter(sector_label == "Public", nivel == "Primary"),
    lng = ~longitude, lat = ~latitude,
    color = "#1565C0", fillColor = "#1565C0", fillOpacity = 0.8,
    radius = 5, weight = 1, opacity = 0.9,
    popup = ~popup_text, group = "Public — Primary"
  ) %>%
  addCircleMarkers(
    data = schools_map %>% filter(sector_label == "Public", nivel == "Secondary"),
    lng = ~longitude, lat = ~latitude,
    color = "#0097A7", fillColor = "#0097A7", fillOpacity = 0.8,
    radius = 5, weight = 1, opacity = 0.9,
    popup = ~popup_text, group = "Public — Secondary"
  ) %>%
  addCircleMarkers(
    data = schools_map %>% filter(sector_label == "Public", nivel == "Technical"),
    lng = ~longitude, lat = ~latitude,
    color = "#00695C", fillColor = "#00695C", fillOpacity = 0.8,
    radius = 5, weight = 1, opacity = 0.9,
    popup = ~popup_text, group = "Public — Technical"
  ) %>%
  addCircleMarkers(
    data = schools_map %>% filter(sector_label == "Private", nivel == "Primary"),
    lng = ~longitude, lat = ~latitude,
    color = "#E53935", fillColor = "#E53935", fillOpacity = 0.8,
    radius = 5, weight = 1, opacity = 0.9,
    popup = ~popup_text, group = "Private — Primary"
  ) %>%
  addCircleMarkers(
    data = schools_map %>% filter(sector_label == "Private", nivel == "Secondary"),
    lng = ~longitude, lat = ~latitude,
    color = "#F57C00", fillColor = "#F57C00", fillOpacity = 0.8,
    radius = 5, weight = 1, opacity = 0.9,
    popup = ~popup_text, group = "Private — Secondary"
  ) %>%
  addCircleMarkers(
    data = schools_map %>% filter(sector_label == "Private", nivel == "Technical"),
    lng = ~longitude, lat = ~latitude,
    color = "#7B1FA2", fillColor = "#7B1FA2", fillOpacity = 0.8,
    radius = 5, weight = 1, opacity = 0.9,
    popup = ~popup_text, group = "Private — Technical"
  ) %>%
  
  addLayersControl(
    overlayGroups = c(
      "Public — Primary", "Public — Secondary", "Public — Technical",
      "Private — Primary", "Private — Secondary", "Private — Technical"
    ),
    options = layersControlOptions(collapsed = FALSE)
  ) %>%
  addLegend(
    position = "bottomright",
    colors   = c("#1565C0", "#0097A7", "#00695C", "#E53935", "#F57C00", "#7B1FA2"),
    labels   = c("Public Primary", "Public Secondary", "Public Technical",
                 "Private Primary", "Private Secondary", "Private Technical"),
    title    = "Sector × Level",
    opacity  = 0.9
  )
# =============================================================================
# SECTION 5: CENSUS VARIABLES (poverty, population — radio censal level)
# =============================================================================

radio_censal_sf <- radio_censal %>%
  mutate(
    geometry     = st_as_sfc(WKT, crs = 4326),
    poverty_rate = H_CON_NBI / T_HOGAR
  ) %>%
  st_as_sf()

cat("\n=== POPULATION (radio censal) ===\n")
summarise(radio_censal_sf,
  mean   = round(mean(TOTAL_POB, na.rm = TRUE), 0),
  median = median(TOTAL_POB, na.rm = TRUE),
  sd     = round(sd(TOTAL_POB, na.rm = TRUE), 0)
) %>% print()
print(quantile(radio_censal_sf$TOTAL_POB, probs = c(0.10, 0.25, 0.75, 0.90), na.rm = TRUE))

cat("\n=== POVERTY RATE (NBI, radio censal) ===\n")
summarise(radio_censal_sf,
  mean  = round(mean(poverty_rate, na.rm = TRUE), 4),
  median = round(median(poverty_rate, na.rm = TRUE), 4),
  sd    = round(sd(poverty_rate, na.rm = TRUE), 4),
  p90   = round(quantile(poverty_rate, 0.90, na.rm = TRUE), 4)
) %>% print()

# Poverty map (Figure 2 in paper)
ggplot(radio_censal_sf) +
  geom_sf(aes(fill = poverty_rate), color = NA) +
  scale_fill_viridis_c(name = "poverty_rate") +
  theme_minimal() +
  labs(title = "Poverty Rate (NBI) by Census Tract, CABA 2010")


# =============================================================================
# SECTION 6: BASELINE CRIME BY FRANJA & DISTANCE BIN
# Anchors the economic interpretation of regression coefficients.
# Reference cell for gradient specs: control × 300_plus
# =============================================================================

# Active grids: recorded at least one robbery over 2016
grids_activos <- crime_panel_final %>%
  group_by(grid_id) %>%
  summarise(total_robos = sum(n_robos), .groups = "drop") %>%
  filter(total_robos > 0) %>%
  pull(grid_id)

cat(sprintf("\nActive grids (≥1 robbery in 2016): %d of %d total\n",
            length(grids_activos), n_distinct(crime_panel_final$grid_id)))

# ── 6a. Baseline by franja (active grids, weekdays) ───────────────────────────
# Used to compute absolute effects from Poisson semi-elasticities

cat("\n=== BASELINE BY FRANJA (active grids, weekdays) ===\n")
crime_panel_final %>%
  filter(
    weekdays(date) %in% c("Montag","Dienstag","Mittwoch","Donnerstag","Freitag"),
    grid_id %in% grids_activos
  ) %>%
  group_by(franja_4cat) %>%
  summarise(
    mean_robos    = round(mean(n_robos),  4),
    mean_crimes   = round(mean(n_crimes), 4),
    mean_hurtos   = round(mean(n_hurtos), 4),
    median_robos  = median(n_robos),
    pct_zeros     = round(mean(n_robos == 0), 3),
    n_grids       = n_distinct(grid_id),
    n_obs         = n()
  ) %>%
  arrange(factor(franja_4cat,
                 levels = c("control","start","exit_primaria","exit_secundaria"))) %>%
  print()

# ── 6b. Baseline by franja × dist_bin (active grids, weekdays) ───────────────
# The reference cell (control × 300_plus) is the denominator for all % effects

cat("\n=== BASELINE BY FRANJA × DIST_BIN (active grids, weekdays) ===\n")
crime_panel_final %>%
  filter(
    weekdays(date) %in% c("Montag","Dienstag","Mittwoch","Donnerstag","Freitag"),
    grid_id %in% grids_activos
  ) %>%
  group_by(franja_4cat, dist_bin) %>%
  summarise(
    mean_robos  = round(mean(n_robos),  4),
    mean_crimes = round(mean(n_crimes), 4),
    pct_zeros   = round(mean(n_robos == 0), 3),
    n_obs       = n(),
    .groups     = "drop"
  ) %>%
  arrange(
    factor(franja_4cat, levels = c("control","start","exit_primaria","exit_secundaria")),
    factor(dist_bin,    levels = c("0_100","100_200","200_300","300_plus"))
  ) %>%
  print(n = 20)

# ── 6c. Back-of-envelope: absolute effect of exit_primaria × 0-100m ──────────
# Coefficient = 0.116 → +12.3% over reference cell
# Reference cell: control × 300_plus mean_robos (from table above)

ref_cell <- crime_panel_final %>%
  filter(
    weekdays(date) %in% c("Montag","Dienstag","Mittwoch","Donnerstag","Freitag"),
    grid_id %in% grids_activos,
    franja_4cat == "control",
    dist_bin    == "300_plus"
  ) %>%
  summarise(mean_robos = mean(n_robos)) %>%
  pull(mean_robos)

coef_exit_0100  <- 0.116   # from z_dist1, Table 3
pct_effect      <- exp(coef_exit_0100) - 1
abs_per_obs     <- ref_cell * pct_effect
n_school_days   <- 211
n_grids_0100    <- crime_panel_final %>%
  filter(dist_bin == "0_100") %>%
  n_distinct(.$grid_id)

cat(sprintf(
  "\n=== BACK-OF-ENVELOPE: exit_primaria × 0-100m ===
Reference cell mean (control × 300+): %.4f robos/grid-day-slot
Coefficient: %.3f → percentage effect: +%.1f%%
Absolute effect per obs: %.4f robos
× %d school days = %.2f additional robberies/grid/year
",
  ref_cell, coef_exit_0100, pct_effect * 100,
  abs_per_obs, n_school_days,
  abs_per_obs * n_school_days
))



# =============================================================================
# SECTION 8: TABLE 1 INPUTS (summary statistics for paper)
# =============================================================================

cat("\n=== TABLE 1: SUMMARY STATISTICS INPUTS ===\n")

# Panel dimensions
cat(sprintf("Panel: %d grids × %d days × 4 slots = %d obs\n",
            n_distinct(crime_panel_final$grid_id),
            n_distinct(crime_panel_final$date),
            nrow(crime_panel_final)))

# Infrastructure controls
cat("\n--- Bus stops & police stations per grid ---\n")
crime_panel_final %>%
  distinct(grid_id, n_bus_stops, n_police) %>%
  summarise(
    mean_bus      = round(mean(n_bus_stops, na.rm = TRUE), 2),
    median_bus    = median(n_bus_stops, na.rm = TRUE),
    max_bus       = max(n_bus_stops, na.rm = TRUE),
    mean_police   = round(mean(n_police, na.rm = TRUE), 2),
    median_police = median(n_police, na.rm = TRUE),
    max_police    = max(n_police, na.rm = TRUE)
  ) %>% print()

# Poverty at grid level
cat("\n--- Poverty rate at grid level (areal-weighted) ---\n")
crime_panel_final %>%
  distinct(grid_id, poverty_rate) %>%
  summarise(
    mean   = round(mean(poverty_rate, na.rm = TRUE), 4),
    median = round(median(poverty_rate, na.rm = TRUE), 4),
    sd     = round(sd(poverty_rate, na.rm = TRUE), 4),
    p90    = round(quantile(poverty_rate, 0.90, na.rm = TRUE), 4),
    pct_missing = round(mean(is.na(poverty_rate)) * 100, 1)
  ) %>% print()

# bimestre index mapping (for Senderos event study reference)
cat("\n--- Bimestre index mapping (SA estimator reference) ---\n")
panel_sa_int0 %>%
  distinct(bim_idx) %>%
  arrange(bim_idx) %>%
  mutate(
    year = 2016 + ((bim_idx - 1) %/% 6),
    bim  = ((bim_idx - 1) %% 6) + 1
  ) %>%
  print(n = 30)


# ==========================
# EXTRA for coefficients interpretations
# ==========================


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

# Medias por franja y dist_bin para exit_primaria y exit_secundaria
crime_panel_final %>%
  filter(franja_4cat %in% c("exit_primaria", "exit_secundaria"),
         dist_bin != "300_plus") %>%
  group_by(franja_4cat, dist_bin) %>%
  summarise(
    mean_robos  = mean(n_robos),
    mean_crimes = mean(n_crimes),
    .groups = "drop"
  )









