# ========================================
setwd("C:/Franco/Univ/Bachelorarbeit/BA Code") # <---- Edit path

library(sf)
library(ggplot2)
library(fixest)
library(tidyverse)

select <- dplyr::select

# ==============
# LOAD DATA
# ==============
perimetro_raw   <- read_csv("perimetro.csv")
caba_perimeter <- st_as_sf(perimetro_raw, wkt = "geometry", crs = 4326)
caba <- caba_perimeter %>%
  st_transform(32721)
barrios <- read.csv("barrios.csv")
barrios_sf <- barrios %>%
  mutate(geometry = st_as_sfc(geometry, crs = 4326)) %>%
  st_as_sf() %>%
  st_transform(32721) %>%
  select(id, nombre, comuna)

plot_coefs <- function(model, title = "") {
  coefs <- as.data.frame(coeftable(model))
  coefs$term <- rownames(coefs)
  coefs <- coefs %>%
    filter(str_detect(term, "franja_4cat|dist_bin|n_esc_buffer")) %>%
    mutate(
      ci_low  = Estimate - 1.96 * `Std. Error`,
      ci_high = Estimate + 1.96 * `Std. Error`,
      pct_effect = (exp(Estimate) - 1) * 100
    )
  
  ggplot(coefs, aes(x = reorder(term, Estimate), y = pct_effect)) +
    geom_point(size = 2) +
    geom_errorbar(aes(
      ymin = (exp(ci_low)  - 1) * 100,
      ymax = (exp(ci_high) - 1) * 100
    ), width = 0.2) +
    geom_hline(yintercept = 0, linetype = "dashed", color = "red") +
    coord_flip() +
    labs(
      title = title,
      x     = NULL,
      y     = "% change in robberies vs. baseline"
    ) +
    theme_minimal()
}


# ── helper ────────────────────────────────────────────────────────────────────
extract_pct <- function(model, pattern) {
  ct <- as.data.frame(coeftable(model))
  ct$term <- rownames(ct)
  ct %>%
    filter(str_detect(term, pattern)) %>%
    mutate(
      pct    = (exp(Estimate) - 1) * 100,
      pct_lo = (exp(Estimate - 1.96 * `Std. Error`) - 1) * 100,
      pct_hi = (exp(Estimate + 1.96 * `Std. Error`) - 1) * 100,
      # extraer franja del term name
      franja = case_when(
        str_detect(term, "exit_primaria")   ~ "Exit primaria",
        str_detect(term, "exit_secundaria") ~ "Exit secundaria",
        str_detect(term, "start")           ~ "Start",
        TRUE                                ~ "Other"
      ),
      # extraer bin o buffer label
      bin = str_extract(term, "0_100|100_200|200_300|300_plus|100m|200m|300m")
    )
}

theme_thesis <- function() {
  theme_minimal(base_size = 11) +
    theme(
      plot.title    = element_text(face = "bold", size = 12),
      plot.subtitle = element_text(size = 9, color = "grey40"),
      legend.position = "bottom",
      panel.grid.minor = element_blank(),
      strip.text = element_text(face = "bold")
    )
}

franja_colors <- c(
  "Exit primaria"   = "#2c7bb6",
  "Exit secundaria" = "#1a9641",
  "Start"           = "#d7191c"
)


crime_panel_500_2016 <- readRDS("crime_panel_final_2016.rds")

crime_panel_500_2016 <- crime_panel_500_2016 %>%
  mutate(is_school_time = ifelse(franja_4cat == "control", 0, 1))

# ── barrio join (si no viene en el RDS) ──────────────────────────────────────
if (!"barrio" %in% colnames(crime_panel_500_2016)) {
  
  if (!exists("barrios_sf")) {
    barrios_sf <- barrios %>%
      mutate(geometry = st_as_sfc(geometry, crs = 4326)) %>%
      st_as_sf() %>%
      st_transform(32721) %>%
      select(id, nombre, comuna)
  }
  
  if (!exists("grid_500_caba")) {
    grid_500_caba <- readRDS("clean_grid_500.rds") %>% st_as_sf()
  }
  
  grid_centroids_500 <- grid_500_caba %>%
    st_centroid() %>%
    select(grid_id)
  
  grid_barrio_500 <- st_join(
    grid_centroids_500,
    barrios_sf %>% select(nombre, comuna),
    join = st_within
  ) %>%
    st_drop_geometry() %>%
    rename(barrio = nombre)
  
  # fallback nearest para grids en borde
  missing_idx <- which(is.na(grid_barrio_500$barrio))
  if (length(missing_idx) > 0) {
    nearest_idx <- st_nearest_feature(
      grid_centroids_500 %>% filter(grid_id %in% grid_barrio_500$grid_id[missing_idx]),
      barrios_sf
    )
    grid_barrio_500$barrio[missing_idx] <- barrios_sf$nombre[nearest_idx]
  }
  
  stopifnot(sum(is.na(grid_barrio_500$barrio)) == 0)
  
  crime_panel_500_2016 <- crime_panel_500_2016 %>%
    left_join(grid_barrio_500 %>% select(grid_id, barrio), by = "grid_id")
  
  cat(sprintf("barrio joined: %d unique barrios | NAs: %d\n",
              n_distinct(crime_panel_500_2016$barrio),
              sum(is.na(crime_panel_500_2016$barrio))))
}




crime_panel_final <- crime_panel_500_2016 %>%
  mutate(
    is_weekend   = as.integer(is_weekend),
    n_commercial = as.integer(n_commercial),
    n_gastronomy = as.integer(n_gastronomy),
    is_school_time = as.integer(is_school_time),
    women_share = coalesce(women_share, 0),
    log_student_density = coalesce(log_student_density, 0)
  )

# PASO 1: Corregir is_weekend en el panel final
crime_panel_final <- crime_panel_final %>%
  mutate(
    is_weekend = as.integer(weekdays(date) %in% 
                              c("Saturday", "Sunday", "sábado", "domingo",
                                "Samstag", "Sonntag"))
  )

# Verificar
table(crime_panel_final$is_weekend)
# Debe dar ~84 días × 907 grids × 4 franjas = ~304,752 weekend obs

# PASO 2: Filtrar del panel de estimación
crime_panel_weekday <- crime_panel_final %>%
  filter(is_weekend == 0)

# Verificar dimensiones
nrow(crime_panel_weekday)  # debe ser ~907 × 211 × 4 = ~765,508
n_distinct(crime_panel_weekday$date)  # debe ser ~211












# ── Aggregate implication: private school effect ──────────────────────────────

# Parámetros del modelo
beta_priv   <- 0.021
beta_triple <- -0.326
poverty_med <- crime_panel_final %>%
  distinct(grid_id, poverty_rate) %>%
  summarise(med = median(poverty_rate, na.rm = TRUE)) %>%
  pull(med)

cat("Poverty median:", round(poverty_med, 4), "\n")

# Netto-Semielastizität
beta_net    <- beta_priv + beta_triple * poverty_med
marginal_pct <- (exp(beta_net) - 1) * 100
cat("Marginal effect at median poverty:", round(marginal_pct, 1), "%\n")

# Baseline mean: robberies por grid-day-slot en CONTROL hours, weekdays
baseline_mean <- crime_panel_weekday %>%
  filter(franja_4cat == "control") %>%
  summarise(m = mean(n_robos, na.rm = TRUE)) %>%
  pull(m)

cat("Baseline mean (control, weekday):", round(baseline_mean, 4), "\n")

# Grids con escuelas privadas
grids_priv_stats <- crime_panel_final %>%
  distinct(grid_id, n_priv_schools) %>%   # <-- ajustá el nombre si difiere
  filter(n_priv_schools >= 1) %>%
  summarise(
    n_grids   = n(),
    mean_priv = mean(n_priv_schools)
  )

cat("Grids con ≥1 priv school:", grids_priv_stats$n_grids, "\n")
cat("Mean priv schools/grid:  ", round(grids_priv_stats$mean_priv, 2), "\n")

# Días lectivos y franjas school-time
school_days  <- n_distinct(crime_panel_weekday$date)
school_slots <- 3   # start + exit_primaria + exit_secundaria

annual_crimes_per_grid <- baseline_mean * school_days * school_slots

aggregate <- grids_priv_stats$n_grids * grids_priv_stats$mean_priv *
  (marginal_pct / 100) * annual_crimes_per_grid

cat("Aggregate annual implication:", round(aggregate), "additional school-hour crimes\n")




# Comparar baseline con n_crimes vs n_robos
crime_panel_weekday %>%
  filter(franja_4cat == "control") %>%
  summarise(
    mean_robos  = mean(n_robos,  na.rm = TRUE),
    mean_crimes = mean(n_crimes, na.rm = TRUE)
  )





# Esto probablemente reproduce el 0.044 y el 97
baseline_all_franjas <- crime_panel_weekday %>%
  summarise(m = mean(n_robos, na.rm = TRUE)) %>%
  pull(m)

aggregate_97 <- 357 * 1.98 * (marginal_pct / 100) * 
  (baseline_all_franjas * school_days * school_slots)

cat(round(baseline_all_franjas, 4), "\n")
cat(round(aggregate_97), "\n")
cat((97 / (357 * 1.98 * 0.0268 * 211 * 3)) * 100, "\n")  # qué marginal_pct implica el 97
cat(marginal_pct, "\n")  # qué da realmente

357 * 1.98 * 0.01 * 0.0268 * 211 * 3
# [1] 95.8

cat(357 * 1.98 * (marginal_pct/100) * 0.0268 * 211 * 3)

(exp(0.021 - 0.326*0.033)-1)*100  # = 1.029% ≈ 1.0% ✓
357 * 1.98 * 0.01029 * 0.0268 * 211 * 3  # → ~97
# Qué baseline implica exactamente 97?
97 / (357 * 1.98 * 0.01029 * 211 * 3)
# [1] ?
crime_panel_weekday %>%
  filter(franja_4cat == "control", n_priv_schools >= 1) %>%
  summarise(m = mean(n_robos, na.rm = TRUE)) %>%
  pull(m)
crime_panel_weekday %>%
  filter(franja_4cat == "control", n_priv_schools >= 1) %>%
  summarise(m = mean(n_crimes, na.rm = TRUE)) %>%
  pull(m)
crime_panel_weekday %>%
  filter(franja_4cat != "control", n_priv_schools >= 1) %>%
  summarise(m = mean(n_crimes, na.rm = TRUE)) %>%
  pull(m)
# ============================
# Panel intensity approach with n_X per grid
# ============================ 

# =============================
# For all crimes without distinction ####
# =============================

# base model
m_A1 <- fepois(
  n_crimes ~ n_schools * is_school_time | grid_id + date,
  data    = crime_panel_weekday,
  cluster = ~grid_id
)
summary(m_A1)

# with 2 controls
m_a2 <- fepois(
  n_crimes ~ is_school_time + n_schools:is_school_time + n_bus_stops:is_school_time + 
    n_police:is_school_time + n_commercial:is_school_time| grid_id + date,
  data    = crime_panel_weekday,
  cluster = ~grid_id
)
summary(m_a2)


# with more controls 
m_A3 <- fepois(n_crimes ~  n_schools*is_school_time*n_bus_stops +
                 n_police*is_school_time + n_commercial*is_school_time +
                 n_gastronomy * is_school_time| grid_id + date,
               data    = crime_panel_weekday,
               cluster = ~grid_id)
summary(m_A3) 

# heterogeneity across private and public schools
m_A4 <- fepois(n_crimes ~  
                 n_pub_schools*is_school_time*is_weekend + 
                 n_priv_schools*is_school_time +
                 n_police * is_school_time| grid_id + date,
               data    = crime_panel_weekday,
               cluster = ~grid_id)
summary(m_A4)



# heterogeneity in school hours
m_A5 <- fepois(
  n_crimes ~ franja_4cat +
    i(franja_4cat, n_schools, ref = "control") + 
    i(franja_4cat, n_bus_stops, ref = "control") + 
    i(franja_4cat, n_police, ref = "control") + 
    i(franja_4cat, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_weekday,
  cluster = ~grid_id
)
summary(m_A5)
(exp(coef(m_A5)) - 1) * 100

#heterogeneity school_hours and sector
m_A6 <- fepois(
  n_crimes ~ franja_4cat +
    i(franja_4cat, n_pub_schools, ref = "control") + 
    i(franja_4cat, n_priv_schools, ref = "control") +
    i(franja_4cat, n_bus_stops, ref = "control") + 
    i(franja_4cat, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_weekday,
  cluster = ~grid_id
)
summary(m_A6)

# heterogeneity across poverty
m_A7 <- fepois(n_crimes ~ is_school_time +
                 n_schools:is_school_time:poverty_rate + n_bus_stops:is_school_time +
                 n_police:is_school_time + n_commercial:is_school_time | grid_id + date,
               data    = crime_panel_weekday,
               cluster = ~grid_id)
summary(m_A7)

#heterogeneity poverty and sector
m_A8 <- fepois(n_crimes ~  n_pub_schools*is_school_time*poverty_rate + n_bus_stops*is_school_time +
                 n_priv_schools*is_school_time*poverty_rate +
                 n_police*is_school_time + n_commercial*is_school_time | grid_id + date,
               data    = crime_panel_weekday,
               cluster = ~grid_id)
summary(m_A8) 
(exp(0.021 - 0.326*0.033)-1)*100
## franja_4cat + sector + poverty rate
m_A9 <- fepois(
  n_crimes ~ franja_4cat +
    i(franja_4cat, n_pub_schools * poverty_rate, ref = "control") + 
    i(franja_4cat, n_priv_schools * poverty_rate, ref = "control") +
    i(franja_4cat, n_bus_stops, ref = "control") + 
    i(franja_4cat, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_weekday,
  cluster = ~grid_id
)
summary(m_A9)




etable(
  m_A1, m_a2, m_A7,
  headers  = c("Baseline", "Controls", "Poverty"),
  keep     = c("is_school_time", "n_schools", "n_bus_stops",
               "n_police", "n_commercial", "poverty_rate"),
  digits   = 3,
  se.below = TRUE,
  title    = "School Density and Crime: Baseline Specifications",
  tex      = TRUE,
  file     = "tables/table1_baseline.tex",
  replace  = TRUE
)


etable(
  m_A4, m_A8,
  headers  = c("Sector", "Sector + Poverty"),
  keep     = c("n_pub_schools", "n_priv_schools", "poverty_rate",
               "n_bus_stops", "n_police", "n_commercial"),
  digits   = 3,
  se.below = TRUE,
  title    = "Heterogeneity by School Sector and Poverty",
  tex      = TRUE,
  file     = "tables/table2_sector.tex",
  replace  = TRUE
)


etable(
  m_A5, m_A6, m_A9,
  headers  = c("Franjas", "Franjas + Sector", "Franjas + Sector + Poverty"),
  digits   = 3,
  se.below = TRUE,
  title    = "Four-Franja Specifications: Baseline, Sector, and Poverty",
  tex      = TRUE,
  file     = "tables/tab_franja4_comparison.tex",
  replace  = TRUE
)
# ========================
# For street robs ####
# ========================
# base model
b1 <- fepois(
  n_robos ~ n_schools * is_school_time | grid_id + date,
  data    = crime_panel_weekday,
  cluster = ~grid_id
)
summary(b1)

# with 2 controls
b2 <- fepois(
  n_robos ~ n_schools * is_school_time + n_bus_stops * is_school_time + 
    n_police * is_school_time + n_commercial * is_school_time| grid_id + date,
  data    = crime_panel_weekday,
  cluster = ~grid_id
)
summary(b2)
(exp(coef(b2)) - 1) * 100

# with weekend dummy 
b3 <- fepois(n_robos ~ is_school_time + n_schools:is_school_time + n_bus_stops * is_school_time +
               n_police:is_school_time + n_commercial:is_school_time | grid_id + date,
             data    = crime_panel_weekday,
             cluster = ~grid_id)
summary(b3) 

# heterogeneity across private and public schools
b4 <- fepois(n_robos ~ is_school_time + n_pub_schools:is_school_time + n_priv_schools:is_school_time +
               n_bus_stops:is_school_time| grid_id + date,
             data    = crime_panel_weekday,
             cluster = ~grid_id)
summary(b4)



# heterogeneity in school hours
b5 <- fepois(
  n_robos ~ franja_4cat +
    i(franja_4cat, n_schools, ref = "control") + 
    i(franja_4cat, n_bus_stops, ref = "control") + 
    i(franja_4cat, n_police, ref = "control") + 
    i(franja_4cat, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_weekday,
  cluster = ~grid_id
)
summary(b5)
(exp(coef(b5)) - 1) * 100

#heterogeneity school_hours and sector
b6 <- fepois(
  n_robos ~ franja_4cat +
    i(franja_4cat, n_pub_schools, ref = "control") + 
    i(franja_4cat, n_priv_schools, ref = "control") +
    i(franja_4cat, n_bus_stops, ref = "control") + 
    i(franja_4cat, n_police, ref = "control") + 
    i(franja_4cat, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_weekday,
  cluster = ~grid_id
)
summary(b6)
(exp(coef(b6)) - 1) * 100
plot_coefs(b6, title = "het across school hours and sector")
# heterogeneity across poverty
b7 <- fepois(
  n_robos ~ franja_4cat +
    i(franja_4cat, n_pub_schools*poverty_rate, ref = "control") + 
    i(franja_4cat, n_priv_schools*poverty_rate, ref = "control") +
    i(franja_4cat, n_bus_stops, ref = "control") + 
    i(franja_4cat, n_police, ref = "control") + 
    i(franja_4cat, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_weekday,
  cluster = ~grid_id
)
summary(b7)
(exp(coef(b7)) -1) * 100
#heterogeneity poverty and sector
b8 <- fepois(n_crimes ~ is_school_time + n_pub_schools:is_school_time:poverty_rate + n_bus_stops:is_school_time +
               n_priv_schools:is_school_time:poverty_rate +
               n_police:is_school_time + n_commercial:is_school_time | grid_id + date,
             data    = crime_panel_weekday,
             cluster = ~grid_id)
summary(b8) 


b9_rob <- fepois(n_robos ~  n_pub_schools*is_school_time*poverty_rate + 
                   n_bus_stops*is_school_time +
                   n_priv_schools*is_school_time*poverty_rate +
                   n_police*is_school_time + n_commercial*is_school_time | grid_id + date,
                 data    = crime_panel_weekday,
                 cluster = ~grid_id)
summary(b9_rob) 

# sector and poverty  
b9_hurt <- fepois(n_hurtos ~ n_pub_schools*is_school_time*poverty_rate + 
                    n_bus_stops*is_school_time +
                    n_priv_schools*is_school_time*poverty_rate +
                    n_police*is_school_time + n_commercial*is_school_time | grid_id + date,
                  data    = crime_panel_weekday,
                  cluster = ~grid_id)
summary(b9_hurt)


# =========================
# For thefts (no violence) ######
# =========================
c1 <- fepois(
  n_hurtos ~ n_schools * is_school_time | grid_id + date,
  data    = crime_panel_weekday,
  cluster = ~grid_id
)
summary(c1)

# with 2 controls
c2 <- fepois(
  n_hurtos ~ n_schools * is_school_time + n_bus_stops * is_school_time + 
    n_police * is_school_time + n_commercial * is_school_time| grid_id + date,
  data    = crime_panel_weekday,
  cluster = ~grid_id
)
summary(c2)
(exp(coef(c2)) - 1) * 100

# with weekend dummy 
c3 <- fepois(n_hurtos ~ is_school_time + n_schools:is_school_time + n_bus_stops * is_school_time +
               n_police:is_school_time + n_commercial:is_school_time | grid_id + date,
             data    = crime_panel_weekday,
             cluster = ~grid_id)
summary(c3) 

# heterogeneity across private and public schools
c4 <- fepois(n_hurtos ~  n_pub_schools*is_school_time + n_priv_schools*is_school_time +
               n_bus_stops*is_school_time| grid_id + date,
             data    = crime_panel_weekday,
             cluster = ~grid_id)
summary(c4)
plot_coefs(c4, "priv and publ schools")

# heterogeneity in school hours
c5 <- fepois(
  n_hurtos ~ franja_4cat +
    i(franja_4cat, n_schools, ref = "control") +
    i(franja_4cat, n_bus_stops, ref = "control") + 
    i(franja_4cat, n_police, ref = "control") + 
    i(franja_4cat, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_weekday,
  cluster = ~grid_id
)
summary(c5)
(exp(coef(b5)) - 1) * 100
plot_coefs(c5, "distance bins")
#heterogeneity school_hours and sector
c6 <- fepois(
  n_hurtos ~ franja_4cat +
    i(franja_4cat, n_pub_schools, ref = "control") + 
    i(franja_4cat, n_priv_schools, ref = "control") +
    i(franja_4cat, n_bus_stops, ref = "control") + 
    i(franja_4cat, n_police, ref = "control") + 
    i(franja_4cat, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_weekday,
  cluster = ~grid_id
)
summary(c6)
plot_coefs(c6, "heterogeneity school hours and sector")
# heterogeneity across poverty
c7 <- fepois(n_hurtos ~ is_school_time + n_schools:is_school_time:poverty_rate + n_bus_stops:is_school_time +
               n_police:is_school_time + n_commercial:is_school_time | grid_id + date,
             data    = crime_panel_weekday,
             cluster = ~grid_id)
summary(c7)

#heterogeneity poverty and sector
c8 <- fepois(n_hurtos ~ is_school_time + n_pub_schools:is_school_time:poverty_rate + n_bus_stops:is_school_time +
               n_priv_schools:is_school_time:poverty_rate +
               n_police:is_school_time + n_commercial:is_school_time | grid_id + date,
             data    = crime_panel_weekday,
             cluster = ~grid_id)
summary(c8) 





# ================================
#  USING STUDENT DENSITY PROXY                                                             ####
# ================================
# For all crimes without distinction ####
# =============================

# base model
z_A1 <- fepois(
  n_crimes ~ students_proxy * is_school_time | grid_id + date,
  data    = crime_panel_weekday,
  cluster = ~grid_id
)
summary(z_A1)

# with 2 controls
z_a2 <- fepois(
  n_crimes ~  students_proxy*is_school_time + n_bus_stops*is_school_time + 
    n_police*is_school_time + n_commercial*is_school_time| grid_id + date,
  data    = crime_panel_weekday,
  cluster = ~grid_id
)
summary(z_a2)


# with more controls 
z_A3 <- fepois(n_crimes ~  students_proxy*is_school_time*n_bus_stops +
                 n_police*is_school_time + students_proxy*n_commercial*is_school_time +
                 n_gastronomy * is_school_time| grid_id + date,
               data    = crime_panel_weekday,
               cluster = ~grid_id)
summary(z_A3) 

# heterogeneity across private and public schools
z_A4 <- fepois(n_crimes ~ 
                 students_pub*is_school_time*n_bus_stops + 
                 students_priv*is_school_time*n_bus_stops +
                 n_police * is_school_time| grid_id + date,
               data    = crime_panel_weekday,
               cluster = ~grid_id)
summary(z_A4)



# heterogeneity in school hours
z_A5 <- fepois(
  n_crimes ~ franja_4cat +
    i(franja_4cat, n_schools * share_priv_students, ref = "control") + 
    i(franja_4cat, n_bus_stops, ref = "control") + 
    i(franja_4cat, n_police, ref = "control") + 
    i(franja_4cat, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_weekday,
  cluster = ~grid_id
)
summary(z_A5)
(exp(coef(z_A5)) - 1) * 100

#heterogeneity school_hours and sector
z_A6 <- fepois(
  n_crimes ~ franja_4cat +
    i(franja_4cat, students_pub, ref = "control") + 
    i(franja_4cat, students_priv, ref = "control") +
    i(franja_4cat, n_bus_stops, ref = "control") + 
    i(franja_4cat, n_police, ref = "control") + 
    i(franja_4cat, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_weekday,
  cluster = ~grid_id
)
summary(z_A6)
(exp(coef(z_A6)) - 1) * 100
# heterogeneity across poverty
z_A7 <- fepois(n_crimes ~ is_school_time +
                 n_schools:is_school_time:poverty_rate + n_bus_stops:is_school_time +
                 n_police:is_school_time + n_commercial:is_school_time | grid_id + date,
               data    = crime_panel_weekday,
               cluster = ~grid_id)
summary(z_A7)

#heterogeneity poverty and sector
z_A8 <- fepois(n_crimes ~  students_priv*is_school_time*poverty_rate + n_bus_stops*is_school_time +
                 students_pub*is_school_time*poverty_rate +
                 n_police*is_school_time + n_commercial*is_school_time | grid_id + date,
               data    = crime_panel_weekday,
               cluster = ~grid_id)
summary(z_A8) 
(exp(coef(z_A8)) - 1) *100




# ==========================
# SCHOOL BUFFERS AND DISTANCE BINS  ########
# ==========================
# regressions on crime without distinction
# ==============================
# M1: gradient espacial — efecto de proximidad a escuela por bin
z_dist1 <- fepois(n_crimes ~ i(franja_4cat, ref = "control") +
                    i(franja_4cat, i.dist_bin, ref = "control", ref2 = "300_plus") | 
                    grid_id + date,
                  data = crime_panel_weekday, cluster = ~grid_id)
summary(z_dist1)

# m2: spatial gradient with controls
z_dist2 <- fepois(n_crimes ~ i(franja_4cat, ref = "control") +
                    i(franja_4cat, i.dist_bin, ref = "control", ref2 = "300_plus") +
                    i(franja_4cat, i.dist_bus_bin, ref = "control", ref2 = "300_plus") +
                    i(franja_4cat, i.dist_police_bin, ref = "control", ref2 = "300_plus")
                  | grid_id + date,
                  data = crime_panel_weekday, 
                  cluster = ~grid_id)
summary(z_dist2)


# M4: 
z_dist4 <- fepois(n_robos ~ franja_4cat +
                    i(franja_4cat, n_esc_buffer_100m, ref = "control") +
                    i(franja_4cat, n_esc_buffer_200m,  ref = "control") +
                    i(franja_4cat, n_esc_buffer_300m, ref = "control") +
                    i(franja_4cat, i.dist_bus_bin, ref = "control", ref2 = "300_plus") +
                    i(franja_4cat, i.dist_police_bin, ref = "control", ref2 = "300_plus")
                  | grid_id + date,
                  data = crime_panel_weekday, cluster = ~grid_id)
summary(z_dist4)



# using school exposure
z_exp <- fepois(n_crimes ~ i(franja_4cat, ref = "control") +
                  i(franja_4cat, exposure_100m, ref = "control") +
                  i(franja_4cat, exposure_200m, ref = "control") +
                  i(franja_4cat, exposure_300m, ref = "control")| grid_id + date,
                data = crime_panel_weekday, cluster = ~grid_id)
summary(z_exp)

etable(
  z_dist1, z_dist2,
  headers  = c("Baseline", "Controls"),
  drop     = c("dist_bus_bin", "dist_police_bin"),
  digits   = 3,
  se.below = TRUE,
  title    = "Spatial Gradient of School-Hour Crime Effects",
  notes    = "Col.~(2) includes distance-bin interactions for nearest bus stop and police station (coefficients omitted). Poisson QMLE, grid and date FE. Cluster SE by grid. $^{*}p<0.10$, $^{**}p<0.05$, $^{***}p<0.01$.",
  tex      = TRUE,
  file     = "tables/table3_gradient.tex",
  replace  = TRUE
)



# =============================================================================
# PLOTS — buffer/distance models (z_dist1, z_dist2, z_dist4, z_exp)
# =============================================================================
library(stringr)
library(patchwork)
dir.create("plots", showWarnings = FALSE)

franja_colors <- c(
  "Exit primaria"   = "#2c7bb6",
  "Exit secundaria" = "#1a9641",
  "Start"           = "#d7191c"
)

theme_thesis <- function() {
  theme_minimal(base_size = 11) +
    theme(
      plot.title      = element_text(face = "bold", size = 12),
      plot.subtitle   = element_text(size = 9, color = "grey40"),
      legend.position = "bottom",
      panel.grid.minor = element_blank()
    )
}

extract_pct <- function(model, pattern) {
  ct <- as.data.frame(coeftable(model))
  ct$term <- rownames(ct)
  ct %>%
    filter(str_detect(term, pattern)) %>%
    mutate(
      pct    = (exp(Estimate) - 1) * 100,
      pct_lo = (exp(Estimate - 1.96 * `Std. Error`) - 1) * 100,
      pct_hi = (exp(Estimate + 1.96 * `Std. Error`) - 1) * 100,
      franja = case_when(
        str_detect(term, "exit_primaria")   ~ "Exit primaria",
        str_detect(term, "exit_secundaria") ~ "Exit secundaria",
        str_detect(term, "start")           ~ "Start",
        TRUE                                ~ "Other"
      ),
      bin = str_extract(term, "0_100|100_200|200_300|300_plus|100m|200m|300m")
    )
}

# -- p_dist1: z_dist1 --
df1 <- extract_pct(z_dist1, pattern = "dist_bin") %>%
  mutate(bin = factor(bin, levels = c("0_100", "100_200", "200_300")))

p_dist1 <- ggplot(df1, aes(x = bin, y = pct, color = franja, group = franja)) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "grey60") +
  geom_errorbar(aes(ymin = pct_lo, ymax = pct_hi),
                width = 0.15, position = position_dodge(0.4)) +
  geom_point(size = 3, position = position_dodge(0.4)) +
  geom_line(position = position_dodge(0.4), linewidth = 0.6, alpha = 0.7) +
  scale_color_manual(values = franja_colors) +
  scale_x_discrete(labels = c("0-100m", "100-200m", "200-300m")) +
  labs(title    = "z_dist1: Spatial gradient — no controls",
       subtitle = "Reference: dist_bin 300m+ | n_crimes | cluster grid_id",
       x = "Distance to nearest school", y = "% change vs. 300m+", color = NULL) +
  theme_thesis()

# -- p_dist2: z_dist2 (solo school dist terms, excluye bus/police) --
df2 <- extract_pct(z_dist2, pattern = "dist_bin") %>%
  filter(!str_detect(term, "dist_bus_bin|dist_police_bin")) %>%
  mutate(bin = factor(bin, levels = c("0_100", "100_200", "200_300")))

p_dist2 <- ggplot(df2, aes(x = bin, y = pct, color = franja, group = franja)) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "grey60") +
  geom_errorbar(aes(ymin = pct_lo, ymax = pct_hi),
                width = 0.15, position = position_dodge(0.4)) +
  geom_point(size = 3, position = position_dodge(0.4)) +
  geom_line(position = position_dodge(0.4), linewidth = 0.6, alpha = 0.7) +
  scale_color_manual(values = franja_colors) +
  scale_x_discrete(labels = c("0-100m", "100-200m", "200-300m")) +
  labs(title    = "z_dist2: Spatial gradient — bus + police controls",
       subtitle = "Reference: dist_bin 300m+ | n_crimes | cluster grid_id",
       x = "Distance to nearest school", y = "% change vs. 300m+", color = NULL) +
  theme_thesis()

# -- p_dist4: z_dist4 (buffer counts, n_robos) --
df4 <- extract_pct(z_dist4, pattern = "n_esc_buffer") %>%
  mutate(bin = factor(bin, levels = c("100m", "200m", "300m")))

p_dist4 <- ggplot(df4, aes(x = bin, y = pct, color = franja, group = franja)) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "grey60") +
  geom_errorbar(aes(ymin = pct_lo, ymax = pct_hi),
                width = 0.15, position = position_dodge(0.4)) +
  geom_point(size = 3, position = position_dodge(0.4)) +
  geom_line(position = position_dodge(0.4), linewidth = 0.6, alpha = 0.7) +
  scale_color_manual(values = franja_colors) +
  scale_x_discrete(labels = c("0-100m", "0-200m", "0-300m")) +
  labs(title    = "z_dist4: Buffer counts — n_robos",
       subtitle = "Cumulative buffers | cluster grid_id",
       x = "Buffer radius", y = "% change per additional school in buffer", color = NULL) +
  theme_thesis()

# -- p_exp: z_exp --
df_exp <- extract_pct(z_exp, pattern = "exposure") %>%
  mutate(bin = factor(bin, levels = c("100m", "200m", "300m")))

p_exp <- ggplot(df_exp, aes(x = bin, y = pct, color = franja, group = franja)) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "grey60") +
  geom_errorbar(aes(ymin = pct_lo, ymax = pct_hi),
                width = 0.15, position = position_dodge(0.4)) +
  geom_point(size = 3, position = position_dodge(0.4)) +
  geom_line(position = position_dodge(0.4), linewidth = 0.6, alpha = 0.7) +
  scale_color_manual(values = franja_colors) +
  scale_x_discrete(labels = c("Exposure 100m", "Exposure 200m", "Exposure 300m")) +
  labs(title    = "z_exp: Exposure index — n_crimes",
       subtitle = "exposure = n_schools × (1/dist) | cluster grid_id",
       x = NULL, y = "% change in crimes", color = NULL) +
  theme_thesis()

# -- panel 2x2 --
p_buffer_panel <- (p_dist1 + p_dist2) / (p_dist4 + p_exp) +
  plot_annotation(
    title    = "Geographic & temporal effects — school distance/buffer models",
    subtitle = "TWFE Poisson | grid_id + date FE | 2016 | Reference: control hours & 300m+"
  )

print(p_buffer_panel)
ggsave("plots/buffer_models_2x2.pdf", p_buffer_panel, width = 13, height = 10)
ggsave("plots/buffer_models_2x2.png", p_buffer_panel, width = 13, height = 10, dpi = 150)


# =============================================================================
# NUEVOS MODELOS — n_hurtos + cluster ~barrio
# =============================================================================

# z_dist1 con n_hurtos
z_dist1_hurtos <- fepois(
  n_hurtos ~ i(franja_4cat, ref = "control") +
    i(franja_4cat, i.dist_bin, ref = "control", ref2 = "300_plus") |
    grid_id + date,
  data = crime_panel_weekday, cluster = ~grid_id)
summary(z_dist1_hurtos)
(exp(coef(z_dist1_hurtos)) - 1) * 100

# z_dist2 con n_hurtos
z_dist2_hurtos <- fepois(
  n_hurtos ~ i(franja_4cat, ref = "control") +
    i(franja_4cat, i.dist_bin,        ref = "control", ref2 = "300_plus") +
    i(franja_4cat, i.dist_bus_bin,    ref = "control", ref2 = "300_plus") +
    i(franja_4cat, i.dist_police_bin, ref = "control", ref2 = "300_plus") |
    grid_id + date,
  data = crime_panel_weekday, cluster = ~grid_id)
summary(z_dist2_hurtos)
(exp(coef(z_dist2_hurtos)) - 1) * 100

# z_dist1 cluster ~barrio (robustez)
z_dist1_barrio <- fepois(
  n_crimes ~ i(franja_4cat, ref = "control") +
    i(franja_4cat, i.dist_bin, ref = "control", ref2 = "300_plus") |
    grid_id + date,
  data = crime_panel_weekday, cluster = ~barrio)
summary(z_dist1_barrio)

# z_dist2 cluster ~barrio (robustez)
z_dist2_barrio <- fepois(
  n_crimes ~ i(franja_4cat, ref = "control") +
    i(franja_4cat, i.dist_bin,        ref = "control", ref2 = "300_plus") +
    i(franja_4cat, i.dist_bus_bin,    ref = "control", ref2 = "300_plus") +
    i(franja_4cat, i.dist_police_bin, ref = "control", ref2 = "300_plus") |
    grid_id + date,
  data = crime_panel_weekday, cluster = ~barrio)
summary(z_dist2_barrio)

# z_dist2_grid_robos
z_dist2_barrio <- fepois(
  n_robos ~ i(franja_4cat, ref = "control") +
    i(franja_4cat, i.dist_bin,        ref = "control", ref2 = "300_plus") +
    i(franja_4cat, i.dist_bus_bin,    ref = "control", ref2 = "300_plus") +
    i(franja_4cat, i.dist_police_bin, ref = "control", ref2 = "300_plus") |
    grid_id + date,
  data = crime_panel_weekday, cluster = ~barrio)
summary(z_dist2_barrio)

# tabla comparativa: grid_id vs barrio cluster, n_crimes vs n_hurtos
etable(
  list(
    "n_crimes / grid"   = z_dist1,
    "n_crimes / barrio" = z_dist1_barrio,
    "n_crimes / barrio and controls" = z_dist2_barrio,
    "n_hurtos / grid"   = z_dist1_hurtos
  ),
  keep   = "dist_bin",
  digits = 3
  
)

# plots n_hurtos
df1_h <- extract_pct(z_dist1_hurtos, pattern = "dist_bin") %>%
  mutate(bin = factor(bin, levels = c("0_100", "100_200", "200_300")))

p_dist1_hurtos <- ggplot(df1_h, aes(x = bin, y = pct, color = franja, group = franja)) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "grey60") +
  geom_errorbar(aes(ymin = pct_lo, ymax = pct_hi),
                width = 0.15, position = position_dodge(0.4)) +
  geom_point(size = 3, position = position_dodge(0.4)) +
  geom_line(position = position_dodge(0.4), linewidth = 0.6, alpha = 0.7) +
  scale_color_manual(values = franja_colors) +
  scale_x_discrete(labels = c("0-100m", "100-200m", "200-300m")) +
  labs(title    = "z_dist1_hurtos: Spatial gradient — n_hurtos",
       subtitle = "Reference: dist_bin 300m+ | cluster grid_id",
       x = "Distance to nearest school", y = "% change vs. 300m+", color = NULL) +
  theme_thesis()

df2_h <- extract_pct(z_dist2_hurtos, pattern = "dist_bin") %>%
  filter(!str_detect(term, "dist_bus_bin|dist_police_bin")) %>%
  mutate(bin = factor(bin, levels = c("0_100", "100_200", "200_300")))

p_dist2_hurtos <- ggplot(df2_h, aes(x = bin, y = pct, color = franja, group = franja)) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "grey60") +
  geom_errorbar(aes(ymin = pct_lo, ymax = pct_hi),
                width = 0.15, position = position_dodge(0.4)) +
  geom_point(size = 3, position = position_dodge(0.4)) +
  geom_line(position = position_dodge(0.4), linewidth = 0.6, alpha = 0.7) +
  scale_color_manual(values = franja_colors) +
  scale_x_discrete(labels = c("0-100m", "100-200m", "200-300m")) +
  labs(title    = "z_dist2_hurtos: Spatial gradient — n_hurtos, controls",
       subtitle = "Reference: dist_bin 300m+ | cluster grid_id",
       x = "Distance to nearest school", y = "% change vs. 300m+", color = NULL) +
  theme_thesis()

p_hurtos_panel <- p_dist1_hurtos + p_dist2_hurtos +
  plot_annotation(
    title    = "Spatial gradient — thefts (n_hurtos)",
    subtitle = "TWFE Poisson | grid_id + date FE | 2016"
  )

print(p_hurtos_panel)
ggsave("plots/dist_hurtos_panel.pdf", p_hurtos_panel, width = 13, height = 5)
ggsave("plots/dist_hurtos_panel.png", p_hurtos_panel, width = 13, height = 5, dpi = 150)




z_dist5_barrio <- fepois(
  n_robos ~ i(franja_4cat, ref = "control") +
    i(franja_4cat, i.dist_bin,        ref = "control", ref2 = "300_plus") +
    i(franja_4cat, i.dist_bus_bin,    ref = "control", ref2 = "300_plus") +
    i(franja_4cat, i.dist_police_bin, ref = "control", ref2 = "300_plus") +
    i(franja_4cat, n_commercial, ref = "control")|
    grid_id + date,
  data = crime_panel_weekday, cluster = ~barrio)
summary(z_dist5_barrio)


z_dist10_barrio <- fepois(
  n_robos ~ i(franja_4cat, ref = "control") +
    i(franja_4cat, i.dist_bin,        ref = "control", ref2 = "300_plus") +
    i(franja_4cat, i.dist_bus_bin,    ref = "control", ref2 = "300_plus") +
    i(franja_4cat, i.dist_police_bin, ref = "control", ref2 = "300_plus") +
    i(franja_4cat, n_gastronomy, ref = "control")|
    grid_id + date,
  data = crime_panel_weekday, cluster = ~barrio)
summary(z_dist10_barrio)



# ================================
#  GRIDS 300x300 APPROACH                                                                                     #####
# ================================
crime_panel_final_300 <- readRDS("crime_panel_final_b_300.rds")

crime_panel_final_300 <- crime_panel_final_300 %>%
  mutate(
    is_weekend = as.integer(weekdays(date) %in% 
                              c("Saturday", "Sunday", "sábado", "domingo",
                                "Samstag", "Sonntag"))
  )

crime_panel_weekday_300 <- crime_panel_final_300 %>%
  filter(is_weekend == 0)

# base model
q_A1 <- fepois(
  n_crimes ~ n_schools * is_school_time | grid_id + date,
  data    = crime_panel_final_300,
  cluster = ~grid_id
)
summary(q_A1)

# with 2 controls
q_a2 <- fepois(
  n_crimes ~ is_school_time + n_schools:is_school_time + n_bus_stops:is_school_time + 
    n_police:is_school_time + n_commercial:is_school_time| grid_id + date,
  data    = crime_panel_final,
  cluster = ~grid_id
)
summary(q_a2)
(exp(coef(q_a2)) - 1) * 100

# with more controls 
q_A3 <- fepois(n_crimes ~  n_schools*is_school_time*n_bus_stops +
                 n_police*is_school_time + n_schools*n_commercial*is_school_time +
                 n_gastronomy * is_school_time| grid_id + date,
               data    = crime_panel_final_300,
               cluster = ~grid_id)
summary(q_A3) 

# heterogeneity across private and public schools
q_A4 <- fepois(n_crimes ~ is_school_time + 
                 n_pub_schools*is_school_time + 
                 n_priv_schools*is_school_time +
                 n_bus_stops * is_school_time +
                 n_police * is_school_time| grid_id + date,
               data    = crime_panel_final_300,
               cluster = ~grid_id)
summary(q_A4)
(exp(coef(q_A4)) - 1) * 100


# heterogeneity in school hours
q_A5 <- fepois(
  n_crimes ~ franja_4cat +
    i(franja_4cat, n_schools, ref = "control") + 
    i(franja_4cat, n_bus_stops, ref = "control") + 
    i(franja_4cat, n_police, ref = "control") + 
    i(franja_4cat, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_final_300,
  cluster = ~grid_id
)
summary(q_A5)
(exp(coef(q_A5)) - 1) * 100
plot_coefs(q_A5, "effect across school_hours")
#heterogeneity school_hours and sector
q_A6 <- fepois(
  n_crimes ~ franja_4cat +
    i(franja_4cat, n_pub_schools, ref = "control") + 
    i(franja_4cat, n_priv_schools, ref = "control") +
    i(franja_4cat, n_bus_stops, ref = "control") + 
    i(franja_4cat, n_police, ref = "control") + 
    i(franja_4cat, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_final_300,
  cluster = ~grid_id
)
summary(q_A6)

# heterogeneity across poverty
q_A7 <- fepois(n_crimes ~ n_schools*is_school_time*poverty_rate +
                 n_bus_stops*is_school_time +
                 n_police*is_school_time + n_commercial*is_school_time | grid_id + date,
               data    = crime_panel_final_300,
               cluster = ~grid_id)
summary(q_A7)

#heterogeneity poverty and sector
q_A8 <- fepois(n_crimes ~ is_school_time + 
                 n_pub_schools*is_school_time*poverty_rate + n_bus_stops*is_school_time +
                 n_priv_schools*is_school_time*poverty_rate +
                 n_police*is_school_time + n_commercial*is_school_time | grid_id + date,
               data    = crime_panel_final_300,
               cluster = ~grid_id)
summary(q_A8) 
(exp(coef(q_A8)) - 1) *100

#hete



# =======================
#  
# =======================

# base model
W1 <- fepois(
  n_robos ~ n_schools * is_school_time | grid_id + date,
  data    = crime_panel_final_300,
  cluster = ~grid_id
)
summary(W1)

# with 2 controls
W2 <- fepois(
  n_robos ~ n_schools * is_school_time + n_bus_stops * is_school_time + 
    n_police * is_school_time + n_commercial * is_school_time| grid_id + date,
  data    = crime_panel_final_300,
  cluster = ~grid_id
)
summary(W2)


# with weekend dummy 
W3 <- fepois(n_robos ~ is_school_time + n_schools:is_school_time + n_bus_stops * is_school_time +
               n_police:is_school_time + n_commercial:is_school_time | grid_id + date,
             data    = crime_panel_final_300,
             cluster = ~grid_id)
summary(W3) 

# heterogeneity across private and public schools
W4 <- fepois(n_robos ~ is_school_time + n_pub_schools:is_school_time + n_priv_schools:is_school_time +
               n_bus_stops:is_school_time| grid_id + date,
             data    = crime_panel_final_300,
             cluster = ~grid_id)
summary(W4)



# heterogeneity in school hours
W5 <- fepois(
  n_robos ~ franja_4cat +
    i(franja_4cat, n_schools, ref = "control") + 
    i(franja_4cat, n_bus_stops, ref = "control") + 
    i(franja_4cat, n_police, ref = "control") + 
    i(franja_4cat, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_final_300,
  cluster = ~grid_id
)
summary(W5)


#heterogeneity school_hours and sector
W6 <- fepois(
  n_robos ~ franja_4cat +
    i(franja_4cat, n_pub_schools, ref = "control") + 
    i(franja_4cat, n_priv_schools, ref = "control") +
    i(franja_4cat, n_bus_stops, ref = "control") + 
    i(franja_4cat, n_police, ref = "control") + 
    i(franja_4cat, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_final_300,
  cluster = ~grid_id
)
summary(W6)

# heterogeneity across poverty
W7 <- fepois(
  n_robos ~ franja_4cat +
    i(franja_4cat, n_pub_schools*poverty_rate, ref = "control") + 
    i(franja_4cat, n_priv_schools*poverty_rate, ref = "control") +
    i(franja_4cat, n_bus_stops, ref = "control") + 
    i(franja_4cat, n_police, ref = "control") + 
    i(franja_4cat, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_final_300,
  cluster = ~grid_id
)
summary(W7)
(exp(coef(W7)) - 1) * 100

plot_coefs(W7, "heterogeneity across poverty rates")
#heterogeneity poverty and sector
W8 <- fepois(n_crimes ~ is_school_time + n_pub_schools:is_school_time:poverty_rate + n_bus_stops:is_school_time +
               n_priv_schools:is_school_time:poverty_rate +
               n_police:is_school_time + n_commercial:is_school_time | grid_id + date,
             data    = crime_panel_final_300,
             cluster = ~grid_id)
summary(W8) 


W9_rob <- fepois(n_robos ~ is_school_time +
                   n_pub_schools:is_school_time:poverty_rate + n_bus_stops:is_school_time +
                   n_priv_schools:is_school_time:poverty_rate +
                   n_police:is_school_time + n_commercial:is_school_time | grid_id + date,
                 data    = crime_panel_final_300,
                 cluster = ~grid_id)
summary(W9_rob) 

# sector and poverty  
W9_hurt <- fepois(n_hurtos ~ is_school_time +
                    n_pub_schools:is_school_time:poverty_rate + n_bus_stops:is_school_time +
                    n_priv_schools:is_school_time:poverty_rate +
                    n_police:is_school_time + n_commercial:is_school_time | grid_id + date,
                  data    = crime_panel_final_300,
                  cluster = ~grid_id)
summary(W9_hurt) 




# =========================
# For thefts (no violence) ######
# =========================
s1 <- fepois(
  n_hurtos ~ n_schools * is_school_time | grid_id + date,
  data    = crime_panel_final_300,
  cluster = ~grid_id
)
summary(s1)

# with 2 controls
s2 <- fepois(
  n_hurtos ~ n_schools * is_school_time + n_bus_stops * is_school_time + 
    n_police * is_school_time + n_commercial * is_school_time| grid_id + date,
  data    = crime_panel_final_300,
  cluster = ~grid_id
)
summary(s2)


# with weekend dummy 
s3 <- fepois(n_hurtos ~ is_school_time + n_schools:is_school_time + n_bus_stops * is_school_time +
               n_police:is_school_time + n_commercial:is_school_time | grid_id + date,
             data    = crime_panel_final_300,
             cluster = ~grid_id)
summary(s3) 

# heterogeneity across private and public schools
s4 <- fepois(n_hurtos ~ n_pub_schools*is_school_time + n_priv_schools*is_school_time +
               n_bus_stops*is_school_time| grid_id + date,
             data    = crime_panel_final_300,
             cluster = ~grid_id)
summary(s4)



# heterogeneity in school hours
s5 <- fepois(
  n_hurtos ~ franja_4cat +
    i(franja_4cat, n_schools, ref = "control") +
    i(franja_4cat, n_bus_stops, ref = "control") + 
    i(franja_4cat, n_police, ref = "control") + 
    i(franja_4cat, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_final_300,
  cluster = ~grid_id
)
summary(s5)


#heterogeneity school_hours and sector
s6 <- fepois(
  n_hurtos ~ franja_4cat +
    i(franja_4cat, n_pub_schools, ref = "control") + 
    i(franja_4cat, n_priv_schools, ref = "control") +
    i(franja_4cat, n_bus_stops, ref = "control") + 
    i(franja_4cat, n_police, ref = "control") + 
    i(franja_4cat, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_final_300,
  cluster = ~comuna
)
summary(s6)

# heterogeneity across poverty
s7 <- fepois(n_hurtos ~ is_school_time + n_schools:is_school_time:poverty_rate + n_bus_stops:is_school_time +
               n_police:is_school_time + n_commercial:is_school_time | grid_id + date,
             data    = crime_panel_final,
             cluster = ~grid_id)
summary(s7)

#heterogeneity poverty and sector
s8 <- fepois(n_hurtos ~  n_pub_schools*is_school_time*poverty_rate + n_bus_stops*is_school_time +
               n_priv_schools*is_school_time*poverty_rate +
               n_police*is_school_time + n_commercial*is_school_time | grid_id + date,
             data    = crime_panel_final_300,
             cluster = ~barrio)
summary(s8) 
(exp(coef(s8)) - 1) * 100
plot_coefs(s8,  "poverty and sector")



# ===============================================
# VERSION 2 OF TIME SLOTS                                         ##########
# ===============================================
# ── Agregación v2 desde crimes_clean_300 ──────────────────────────────────────
# v2 subset — panel independiente para robustness
crime_panel_v2_300 <- readRDS("crime_panel_v2_300.rds")


# base model
f_A1 <- fepois(
  n_crimes_v2 ~ n_schools * is_school_time_v2 | grid_id + date,
  data    = crime_panel_v2_300,
  cluster = ~grid_id
)
summary(f_A1)

# with 2 controls
f_a2 <- fepois(
  n_crimes_v2 ~ is_school_time_v2 + n_schools:is_school_time_v2 + n_bus_stops:is_school_time_v2 + 
    n_police:is_school_time_v2 + n_commercial:is_school_time_v2| grid_id + date,
  data    = crime_panel_v2_300,
  cluster = ~grid_id
)
summary(f_a2)
(exp(coef(f_a2)) - 1) * 100

# with more controls 
f_A3 <- fepois(n_crimes_v2 ~  n_schools*is_school_time_v2*n_bus_stops +
                 n_police*is_school_time_v2 + n_schools*n_commercial*is_school_time_v2 +
                 n_gastronomy * is_school_time_v2| grid_id + date,
               data    = crime_panel_v2_300,
               cluster = ~grid_id)
summary(f_A3) 

# heterogeneity across private and public schools
f_A4 <- fepois(n_crimes_v2 ~ n_pub_schools*is_school_time_v2 + 
                 n_priv_schools*is_school_time_v2 +
                 n_bus_stops * is_school_time_v2 +
                 n_police * is_school_time_v2| grid_id + date,
               data    = crime_panel_v2_300,
               cluster = ~grid_id)
summary(f_A4)
(exp(coef(q_A4)) - 1) * 100


# heterogeneity in school hours
f_A5 <- fepois(
  n_crimes_v2 ~ school_day_times_v2 +
    i(school_day_times_v2, n_schools, ref = "control") + 
    i(school_day_times_v2, n_bus_stops, ref = "control") + 
    i(school_day_times_v2, n_police, ref = "control") + 
    i(school_day_times_v2, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_v2_300,
  cluster = ~grid_id
)
summary(f_A5)
(exp(coef(f_A5)) - 1) * 100
plot_coefs(f_A5, "effect across school_hours")
#heterogeneity school_hours and sector
f_A6 <- fepois(
  n_crimes_v2 ~ school_day_times_v2 +
    i(school_day_times_v2, n_pub_schools, ref = "control") + 
    i(school_day_times_v2, n_priv_schools, ref = "control") +
    i(school_day_times_v2, n_bus_stops, ref = "control") + 
    i(school_day_times_v2, n_police, ref = "control") + 
    i(school_day_times_v2, n_commercial, ref = "control") | grid_id + date,
  data    = crime_panel_v2_300,
  cluster = ~grid_id
)
summary(f_A6)

# heterogeneity across poverty
f_A7 <- fepois(n_crimes ~ n_schools*is_school_time*poverty_rate +
                 n_bus_stops*is_school_time +
                 n_police*is_school_time + n_commercial*is_school_time | grid_id + date,
               data    = crime_panel_final_300,
               cluster = ~grid_id)
summary(f_A7)

#heterogeneity poverty and sector
f_A8 <- fepois(n_crimes ~ is_school_time + 
                 n_pub_schools*is_school_time*poverty_rate + n_bus_stops*is_school_time +
                 n_priv_schools*is_school_time*poverty_rate +
                 n_police*is_school_time + n_commercial*is_school_time | grid_id + date,
               data    = crime_panel_final_300,
               cluster = ~grid_id)
summary(f_A8) 
(exp(coef(f_A8)) - 1) *100




j1 <- fepois(n_crimes_v2 ~ i(school_day_times_v2, ref = "control") +
               i(school_day_times_v2, i.dist_bin, ref = "control", ref2 = "300_plus") | grid_id + date,
             data = crime_panel_v2_300, cluster = ~grid_id)
summary(j1)

# m2: spatial gradient with controls
j2 <- fepois(n_crimes_v2 ~ school_day_times_v2 +
               i(school_day_times_v2, i.dist_bin, ref = "control", ref2 = "300_plus") +
               i(school_day_times_v2, i.dist_bus_bin, ref = "control", ref2 = "300_plus") +
               i(school_day_times_v2, i.dist_police_bin, ref = "control", ref2 = "300_plus")
             | grid_id + date,
             data = crime_panel_v2_300, 
             cluster = ~grid_id)
summary(j2)



etable(
  j1, j2,
  keep_raw = "dist_bin::0_100|dist_bin::100_200|dist_bin::200_300",
  headers = c("Base (v2)", "Controls (v2)"),
  title = "Robustness: Alternative school-hour definition",
  tex   = TRUE,
  file  = "tables/tab_v2_hours.tex"
)





# ==========================
# SCHOOL BUFFERS AND DISTANCE BINS  ########
# ==========================
# regressions on crime without distinction
# ==============================
# M1: gradient espacial — efecto de proximidad a escuela por bin


# buffer counts y exposure para grid 300
# compute_buffer_count y compute_exposure ya definidas arriba para grid 500
# schools_sf debe estar en entorno (se usa en Data_preparation)




y1 <- fepois(n_crimes ~ i(franja_4cat, ref = "control") +
               i(franja_4cat, i.dist_bin, ref = "control", ref2 = "300_plus") | grid_id + date,
             data = crime_panel_final_300, cluster = ~grid_id)
summary(y1)

# m2: spatial gradient with controls
y2 <- fepois(n_crimes ~ franja_4cat +
               i(franja_4cat, i.dist_bin, ref = "control", ref2 = "300_plus") +
               i(franja_4cat, i.dist_bus_bin, ref = "control", ref2 = "300_plus") +
               i(franja_4cat, i.dist_police_bin, ref = "control", ref2 = "300_plus")
             | grid_id + date,
             data = crime_panel_final_300, 
             cluster = ~grid_id)
summary(y2)


# M4: 
y4 <- fepois(n_robos ~ franja_4cat +
               i(franja_4cat, n_esc_buffer_100m, ref = "control") +
               i(franja_4cat, n_esc_buffer_200m,  ref = "control") +
               i(franja_4cat, n_esc_buffer_300m, ref = "control") +
               i(franja_4cat, i.dist_bus_bin, ref = "control", ref2 = "300_plus") +
               i(franja_4cat, i.dist_police_bin, ref = "control", ref2 = "300_plus")
             | grid_id + date,
             data = crime_panel_final_300, cluster = ~barrio)
summary(y4)
(exp(coef(y4)) - 1) * 100


# using school exposure
m_exp <- fepois(n_crimes ~ i(franja_4cat, ref = "control") +
                  i(franja_4cat, exposure_100m, ref = "control") +
                  i(franja_4cat, exposure_200m, ref = "control") +
                  i(franja_4cat, exposure_300m, ref = "control")| grid_id + date,
                data = crime_panel_final, cluster = ~grid_id)
summary(m_exp)




# =============================================================================
# PLOTS — buffer/distance models
# =============================================================================
library(stringr)
library(patchwork)
dir.create("plots", showWarnings = FALSE)

DIST_LEVELS <- c("0_100", "100_200", "200_300", "300_plus")

franja_colors <- c(
  "Exit primaria"   = "#2c7bb6",
  "Exit secundaria" = "#1a9641",
  "Start"           = "#d7191c"
)

theme_thesis <- function() {
  theme_minimal(base_size = 11) +
    theme(
      plot.title       = element_text(face = "bold", size = 12),
      plot.subtitle    = element_text(size = 9, color = "grey40"),
      legend.position  = "bottom",
      panel.grid.minor = element_blank()
    )
}

extract_pct <- function(model, pattern, exclude = NULL) {
  ct <- as.data.frame(coeftable(model))
  ct$term <- rownames(ct)
  ct <- ct %>% filter(str_detect(term, pattern))
  if (!is.null(exclude)) ct <- ct %>% filter(!str_detect(term, exclude))
  ct %>%
    mutate(
      pct    = (exp(Estimate) - 1) * 100,
      pct_lo = (exp(Estimate - 1.96 * `Std. Error`) - 1) * 100,
      pct_hi = (exp(Estimate + 1.96 * `Std. Error`) - 1) * 100,
      franja = case_when(
        str_detect(term, "exit_primaria")   ~ "Exit primaria",
        str_detect(term, "exit_secundaria") ~ "Exit secundaria",
        str_detect(term, "start")           ~ "Start",
        TRUE                                ~ "Other"
      ),
      bin = str_extract(term, "0_100|100_200|200_300|100m|200m|300m")
    )
}

make_distplot <- function(df, title, subtitle) {
  df <- df %>% mutate(bin = factor(bin, levels = c("0_100","100_200","200_300")))
  ggplot(df, aes(x = bin, y = pct, color = franja, group = franja)) +
    geom_hline(yintercept = 0, linetype = "dashed", color = "grey60") +
    geom_errorbar(aes(ymin = pct_lo, ymax = pct_hi),
                  width = 0.15, position = position_dodge(0.4)) +
    geom_point(size = 3, position = position_dodge(0.4)) +
    geom_line(position = position_dodge(0.4), linewidth = 0.6, alpha = 0.7) +
    scale_color_manual(values = franja_colors) +
    scale_x_discrete(labels = c("0-100m","100-200m","200-300m")) +
    labs(title = title, subtitle = subtitle,
         x = "Distance to nearest school",
         y = "% change vs. 300m+", color = NULL) +
    theme_thesis()
}

make_bufplot <- function(df, title, subtitle) {
  df <- df %>% mutate(bin = factor(bin, levels = c("100m","200m","300m")))
  ggplot(df, aes(x = bin, y = pct, color = franja, group = franja)) +
    geom_hline(yintercept = 0, linetype = "dashed", color = "grey60") +
    geom_errorbar(aes(ymin = pct_lo, ymax = pct_hi),
                  width = 0.15, position = position_dodge(0.4)) +
    geom_point(size = 3, position = position_dodge(0.4)) +
    geom_line(position = position_dodge(0.4), linewidth = 0.6, alpha = 0.7) +
    scale_color_manual(values = franja_colors) +
    scale_x_discrete(labels = c("0-100m","0-200m","0-300m")) +
    labs(title = title, subtitle = subtitle,
         x = "Buffer radius",
         y = "% change per additional school", color = NULL) +
    theme_thesis()
}

# --- grid 500 ---
p_z1 <- make_distplot(
  extract_pct(z_dist1, "dist_bin"),
  "z_dist1: Gradient — n_crimes (500m grid)",
  "No controls | cluster grid_id"
)

p_z2 <- make_distplot(
  extract_pct(z_dist2, "dist_bin", exclude = "dist_bus|dist_police"),
  "z_dist2: Gradient — n_crimes (500m grid)",
  "Bus + police controls | cluster grid_id"
)

p_z4 <- make_bufplot(
  extract_pct(z_dist4, "n_esc_buffer"),
  "z_dist4: Buffer counts — n_robos (500m grid)",
  "Cumulative buffers | cluster grid_id"
)

# --- grid 300 ---
p_y1 <- make_distplot(
  extract_pct(y1, "dist_bin"),
  "y1: Gradient — n_crimes (300m grid)",
  "No controls | cluster grid_id"
)

p_y2 <- make_distplot(
  extract_pct(y2, "dist_bin", exclude = "dist_bus|dist_police"),
  "y2: Gradient — n_crimes (300m grid)",
  "Bus + police controls | cluster grid_id"
)

p_y4 <- make_bufplot(
  extract_pct(y4, "n_esc_buffer"),
  "y4: Buffer counts — n_robos (300m grid)",
  "Cumulative buffers | cluster barrio"
)

# --- panel 500 (3 modelos) ---
p_500 <- (p_z1 + p_z2 + p_z4) +
  plot_annotation(
    title    = "Grid 500m — spatial gradient & buffer models",
    subtitle = "TWFE Poisson | grid_id + date FE | 2016"
  )

# --- panel 300 (3 modelos) ---
p_300 <- (p_y1 + p_y2 + p_y4) +
  plot_annotation(
    title    = "Grid 300m — spatial gradient & buffer models",
    subtitle = "TWFE Poisson | grid_id + date FE | 2016"
  )

# --- comparativo 500 vs 300 (dist1 y dist2 lado a lado) ---
p_compare <- (p_z1 + p_y1) / (p_z2 + p_y2) +
  plot_annotation(
    title    = "Robustness: 500m vs 300m grid — spatial gradient",
    subtitle = "Same spec, different grid size | reference: 300m+"
  )

print(p_500)
print(p_300)
print(p_compare)

ggsave("plots/grid500_buffer_models.pdf",  p_500,     width = 15, height = 5)
ggsave("plots/grid300_buffer_models.pdf",  p_300,     width = 15, height = 5)
ggsave("plots/robustness_500vs300.pdf",    p_compare, width = 12, height = 10)
ggsave("plots/grid500_buffer_models.png",  p_500,     width = 15, height = 5,  dpi = 150)
ggsave("plots/grid300_buffer_models.png",  p_300,     width = 15, height = 5,  dpi = 150)
ggsave("plots/robustness_500vs300.png",    p_compare, width = 12, height = 10, dpi = 150)

cat("Plots saved to plots/\n")


# =============================================================================
# HETEROGENEITY MODELS — buffer/distance specs                                                        ####
# =============================================================================

# --- sector (pub vs priv) × franja ---
# 500m grid
z_dist_sec <- fepois(
  n_crimes ~ i(franja_4cat, ref = "control") +
    i(franja_4cat, i.dist_bin,     ref = "control", ref2 = "300_plus") +
    i(franja_4cat, n_pub_schools,  ref = "control") +
    i(franja_4cat, n_priv_schools, ref = "control") |
    grid_id + date,
  data = crime_panel_final, cluster = ~grid_id)
summary(z_dist_sec)

# 300m grid
y_dist_sec <- fepois(
  n_crimes ~ i(franja_4cat, ref = "control") +
    i(franja_4cat, i.dist_bin,     ref = "control", ref2 = "300_plus") +
    i(franja_4cat, n_pub_schools,  ref = "control") +
    i(franja_4cat, n_priv_schools, ref = "control") |
    grid_id + date,
  data = crime_panel_final_300, cluster = ~grid_id)
summary(y_dist_sec)

# --- poverty × franja × dist_bin ---
# 500m
z_dist_pov <- fepois(
  n_crimes ~ i(franja_4cat, ref = "control") +
    i(franja_4cat, i.dist_bin,   ref = "control", ref2 = "300_plus") +
    i(franja_4cat, poverty_rate, ref = "control") |
    grid_id + date,
  data = crime_panel_final, cluster = ~grid_id)
summary(z_dist_pov)

# 300m
y_dist_pov <- fepois(
  n_crimes ~ i(franja_4cat, ref = "control") +
    i(franja_4cat, i.dist_bin,   ref = "control", ref2 = "300_plus") +
    i(franja_4cat, poverty_rate, ref = "control") |
    grid_id + date,
  data = crime_panel_final_300, cluster = ~grid_id)
summary(y_dist_pov)

# --- buffer counts × sector — n_robos ---
# 500m
z_buf_sec <- fepois(
  n_robos ~ franja_4cat +
    i(franja_4cat, n_esc_buffer_100m, ref = "control") +
    i(franja_4cat, n_esc_buffer_200m, ref = "control") +
    i(franja_4cat, n_esc_buffer_300m, ref = "control") +
    i(franja_4cat, n_pub_schools,     ref = "control") +
    i(franja_4cat, n_priv_schools,    ref = "control") |
    grid_id + date,
  data = crime_panel_final, cluster = ~grid_id)
summary(z_buf_sec)

# 300m
y_buf_sec <- fepois(
  n_robos ~ franja_4cat +
    i(franja_4cat, n_esc_buffer_100m, ref = "control") +
    i(franja_4cat, n_esc_buffer_200m, ref = "control") +
    i(franja_4cat, n_esc_buffer_300m, ref = "control") +
    i(franja_4cat, n_pub_schools,     ref = "control") +
    i(franja_4cat, n_priv_schools,    ref = "control") |
    grid_id + date,
  data = crime_panel_final_300, cluster = ~barrio)
summary(y_buf_sec)

# --- buffer counts × poverty --- 
# 500m
z_buf_pov <- fepois(
  n_robos ~ franja_4cat +
    i(franja_4cat, n_esc_buffer_100m, ref = "control") +
    i(franja_4cat, n_esc_buffer_200m, ref = "control") +
    i(franja_4cat, n_esc_buffer_300m, ref = "control") +
    i(franja_4cat, poverty_rate,      ref = "control") |
    grid_id + date,
  data = crime_panel_final, cluster = ~grid_id)
summary(z_buf_pov)

# 300m
y_buf_pov <- fepois(
  n_robos ~ franja_4cat +
    i(franja_4cat, n_esc_buffer_100m, ref = "control") +
    i(franja_4cat, n_esc_buffer_200m, ref = "control") +
    i(franja_4cat, n_esc_buffer_300m, ref = "control") +
    i(franja_4cat, poverty_rate,      ref = "control") |
    grid_id + date,
  data = crime_panel_final_300, cluster = ~barrio)
summary(y_buf_pov)

# % effects
(exp(coef(z_dist_sec)) - 1) * 100
(exp(coef(z_dist_pov)) - 1) * 100
(exp(coef(z_buf_sec))  - 1) * 100
(exp(coef(z_buf_pov))  - 1) * 100



# =============================================================================
# PLOTS — heterogeneity models
# =============================================================================

# --- sector ---
p_z_sec <- make_distplot(
  extract_pct(z_dist_sec, "dist_bin"),
  "Gradient + sector — n_crimes (500m)",
  "pub/priv schools as additional interactions | cluster grid_id"
)

p_y_sec <- make_distplot(
  extract_pct(y_dist_sec, "dist_bin"),
  "Gradient + sector — n_crimes (300m)",
  "pub/priv schools as additional interactions | cluster grid_id"
)

p_z_buf_sec <- make_bufplot(
  extract_pct(z_buf_sec, "n_esc_buffer"),
  "Buffer + sector — n_robos (500m)",
  "cluster grid_id"
)

p_y_buf_sec <- make_bufplot(
  extract_pct(y_buf_sec, "n_esc_buffer"),
  "Buffer + sector — n_robos (300m)",
  "cluster barrio"
)

# --- poverty ---
p_z_pov <- ggplot(
  extract_pct(z_dist_pov, "poverty_rate") %>%
    mutate(franja = factor(franja, levels = c("Start","Exit primaria","Exit secundaria"))),
  aes(x = franja, y = pct, color = franja)
) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "grey60") +
  geom_errorbar(aes(ymin = pct_lo, ymax = pct_hi), width = 0.2) +
  geom_point(size = 3) +
  scale_color_manual(values = franja_colors) +
  labs(title    = "Poverty heterogeneity — n_crimes (500m)",
       subtitle = "i(franja_4cat, poverty_rate) | cluster grid_id",
       x = NULL, y = "% change per unit poverty_rate", color = NULL) +
  theme_thesis()

p_y_pov <- ggplot(
  extract_pct(y_dist_pov, "poverty_rate") %>%
    mutate(franja = factor(franja, levels = c("Start","Exit primaria","Exit secundaria"))),
  aes(x = franja, y = pct, color = franja)
) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "grey60") +
  geom_errorbar(aes(ymin = pct_lo, ymax = pct_hi), width = 0.2) +
  geom_point(size = 3) +
  scale_color_manual(values = franja_colors) +
  labs(title    = "Poverty heterogeneity — n_crimes (300m)",
       subtitle = "i(franja_4cat, poverty_rate) | cluster grid_id",
       x = NULL, y = "% change per unit poverty_rate", color = NULL) +
  theme_thesis()

p_z_buf_pov <- ggplot(
  extract_pct(z_buf_pov, "poverty_rate") %>%
    mutate(franja = factor(franja, levels = c("Start","Exit primaria","Exit secundaria"))),
  aes(x = franja, y = pct, color = franja)
) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "grey60") +
  geom_errorbar(aes(ymin = pct_lo, ymax = pct_hi), width = 0.2) +
  geom_point(size = 3) +
  scale_color_manual(values = franja_colors) +
  labs(title    = "Poverty × buffer — n_robos (500m)",
       subtitle = "i(franja_4cat, poverty_rate) | cluster grid_id",
       x = NULL, y = "% change per unit poverty_rate", color = NULL) +
  theme_thesis()

p_y_buf_pov <- ggplot(
  extract_pct(y_buf_pov, "poverty_rate") %>%
    mutate(franja = factor(franja, levels = c("Start","Exit primaria","Exit secundaria"))),
  aes(x = franja, y = pct, color = franja)
) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "grey60") +
  geom_errorbar(aes(ymin = pct_lo, ymax = pct_hi), width = 0.2) +
  geom_point(size = 3) +
  scale_color_manual(values = franja_colors) +
  labs(title    = "Poverty × buffer — n_robos (300m)",
       subtitle = "i(franja_4cat, poverty_rate) | cluster barrio",
       x = NULL, y = "% change per unit poverty_rate", color = NULL) +
  theme_thesis()

# --- panels ---
p_het_sec <- (p_z_sec + p_y_sec) / (p_z_buf_sec + p_y_buf_sec) +
  plot_annotation(
    title    = "Sector heterogeneity — public vs private schools",
    subtitle = "TWFE Poisson | grid_id + date FE | 2016"
  )

p_het_pov <- (p_z_pov + p_y_pov) / (p_z_buf_pov + p_y_buf_pov) +
  plot_annotation(
    title    = "Poverty heterogeneity",
    subtitle = "TWFE Poisson | grid_id + date FE | 2016"
  )

print(p_het_sec)
print(p_het_pov)

ggsave("plots/heterogeneity_sector.pdf",  p_het_sec, width = 12, height = 10)
ggsave("plots/heterogeneity_poverty.pdf", p_het_pov, width = 12, height = 10)
ggsave("plots/heterogeneity_sector.png",  p_het_sec, width = 12, height = 10, dpi = 150)
ggsave("plots/heterogeneity_poverty.png", p_het_pov, width = 12, height = 10, dpi = 150)

cat("Heterogeneity plots saved to plots/\n")

# PLOT 4: z_exp — exposure (n_schools/distance) — n_crimes #####
# =============================================================================
library(stringr)
#install.packages("patchwork")
library(patchwork)
df_exp <- extract_pct(z_exp, pattern = "exposure") %>%
  mutate(bin = factor(bin, levels = c("100m", "200m", "300m")))

p4 <- ggplot(df_exp, aes(x = bin, y = pct, color = franja, group = franja)) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "grey60") +
  geom_errorbar(aes(ymin = pct_lo, ymax = pct_hi),
                width = 0.15, position = position_dodge(0.4)) +
  geom_point(size = 3, position = position_dodge(0.4)) +
  geom_line(position = position_dodge(0.4), linewidth = 0.6, alpha = 0.7) +
  scale_color_manual(values = franja_colors) +
  scale_x_discrete(labels = c("Exposure 100m", "Exposure 200m", "Exposure 300m")) +
  labs(
    title    = "z_exp: School exposure index — n_crimes",
    subtitle = "exposure = n_schools × (1/dist) | cluster grid_id",
    x        = NULL,
    y        = "% change in crimes",
    color    = NULL
  ) +
  theme_thesis()
(exp(0.021)-1)*100
# =============================================
# SPATIAL AUTOCORRELARTION STANDARD ERRORS                     
# =============================================
# =============================================================================
# CONLEY STANDARD ERRORS  ####
# =============================================================================
# install.packages("conleyreg")
library(conleyreg)

# --- centroides ---
centroids_500 <- grid_500_caba %>%
  st_centroid() %>%
  st_transform(4326) %>%       # <-- WGS84 para Haversine
  mutate(
    lon = st_coordinates(.)[,1],
    lat = st_coordinates(.)[,2]
  ) %>%
  st_drop_geometry() %>%
  select(grid_id, lon, lat)

grid_300_caba <- st_make_grid(
  caba,
  cellsize = 300,
  square   = TRUE
) %>%
  st_sf() %>%
  mutate(grid_id = row_number()) %>%
  st_intersection(caba) %>%
  mutate(grid_id = row_number())

centroids_300 <- grid_300_caba %>%
  st_centroid() %>%
  st_transform(4326) %>%
  mutate(
    lon = st_coordinates(.)[,1],
    lat = st_coordinates(.)[,2]
  ) %>%
  st_drop_geometry() %>%
  select(grid_id, lon, lat)

crime_panel_weekday <- crime_panel_weekday%>%
  left_join(centroids_500, by = "grid_id")

crime_panel_final_300 <- crime_panel_final_300 %>%
  select(-any_of(c("lon", "lat", "lon.x", "lat.x", "lon.y", "lat.y"))) %>%
  left_join(centroids_300, by = "grid_id")

# verificar
stopifnot(c("lon", "lat") %in% colnames(crime_panel_final_300))

# re-estimar y1 e y2
y1 <- fepois(
  n_robos ~ i(franja_4cat, ref = "control") +
    i(franja_4cat, i.dist_bin, ref = "control", ref2 = "300_plus") |
    grid_id + date,
  data = crime_panel_final_300, cluster = ~grid_id
)

y2 <- fepois(
  n_robos ~ i(franja_4cat, ref = "control") +
    i(franja_4cat, i.dist_bin,        ref = "control", ref2 = "300_plus") +
    i(franja_4cat, i.dist_bus_bin,    ref = "control", ref2 = "300_plus") +
    i(franja_4cat, i.dist_police_bin, ref = "control", ref2 = "300_plus") |
    grid_id + date,
  data = crime_panel_final_300, cluster = ~grid_id
)

# --- Conley SEs sobre z_dist1 y z_dist2 (500m) ---
# install.packages("fixest")  #
# Conley via vcov_conley de fixest (desde v0.11)
# install.packages("fixest")  # 
# Conley via vcov_conley de fixest (desde v0.11)
# install.packages("fixest")  # 
# Conley via vcov_conley de fixest (desde v0.11)

# 500m grid — consistente con y1/y2
summary(z_dist1, vcov = conley(cutoff = 0.005))   # ~500m
summary(z_dist1, vcov = conley(cutoff = 0.009))   # ~1km

summary(z_dist2, vcov = conley(cutoff = 0.005))
summary(z_dist2, vcov = conley(cutoff = 0.009))

# 300m grid
summary(y1, vcov = conley(cutoff = 0.003))        # ~300m
summary(y1, vcov = conley(cutoff = 0.006))        # ~600m

summary(y2, vcov = conley(cutoff = 0.003))
summary(y2, vcov = conley(cutoff = 0.006))



c("lon", "lat") %in% colnames(crime_panel_final)
c("lon", "lat") %in% colnames(crime_panel_final_300)
# --- comparación SEs: cluster vs Conley ---
etable(
  list(
    "Cluster grid" = z_dist1,
    "Conley 0.5km" = summary(z_dist1, vcov = conley(0.5)),
    "Conley 1km"   = summary(z_dist1, vcov = conley(1))
  ),
  keep = "dist_bin", digits = 3,
  title = "z_dist1: SE robustness"
)

etable(
  list(
    "Cluster grid" = z_dist2,
    "Conley 0.5km" = summary(z_dist2, vcov = conley(0.5)),
    "Conley 1km"   = summary(z_dist2, vcov = conley(1))
  ),
  keep = "dist_bin", digits = 3,
  title = "z_dist2: SE robustness"
)

etable(
  list(
    "Cluster grid" = summary(y1, vcov = ~grid_id),
    "Conley 0.3km" = summary(y1, vcov = conley(cutoff = 0.003)),
    "Conley 0.6km" = summary(y1, vcov = conley(cutoff = 0.006))
  ),
  keep   = "dist_bin",
  digits = 3,
  title  = "y1: SE robustness"
)

etable(
  list(
    "Cluster grid" = y2,
    "Conley 0.3km" = summary(y2, vcov = conley(0.3)),
    "Conley 0.6km" = summary(y2, vcov = conley(0.6))
  ),
  keep = "dist_bin", digits = 3,
  title = "y2: SE robustness"
)




# table for comparison
etable(
  y1, y2, f_a2,
  headers = c("Main spec (v1)", "Main spec (v1) robos", "wider windows (v2)"),
  title   = "Robustness: Alternative school-hour definition",
  tex     = TRUE,
  file    = "tables/tab_v2_hours.tex"
)




# =============================================================================
# ROBUSTNESS: Excluir grids de borde del perímetro de CABA
# =============================================================================

# 1. Cargar límite de CABA (ya deberías tenerlo)
#    Si viene de barrios_sf: caba_boundary <- st_union(barrios_sf)
#    Si tenés shapefile propio: caba_boundary <- st_read("caba_limite.shp") %>% st_transform(22174)

caba_boundary <- st_union(barrios_sf) %>% st_transform(22174)

# 2. Identificar grids de borde:
#    Un grid es "de borde" si su geometría NO está completamente contenida en CABA
#    es decir, si st_within() devuelve FALSE

grid_500_caba_proj <- grid_500_caba %>% st_transform(22174)

interior_grids <- st_within(grid_500_caba_proj, caba_boundary, sparse = FALSE)[,1]
# interior_grids: vector lógico, TRUE = grid completamente dentro del polígono

border_grid_ids <- grid_500_caba_proj$grid_id[!interior_grids]

cat(sprintf("Grids totales: %d | Borde: %d | Interior: %d\n",
            nrow(grid_500_caba_proj),
            length(border_grid_ids),
            sum(interior_grids)))

# 3. Panel sin grids de borde
crime_panel_interior <- crime_panel_weekday%>%
  filter(!grid_id %in% border_grid_ids)

stopifnot(n_distinct(crime_panel_interior$grid_id) == sum(interior_grids))

# 4. Correr specs principales sobre panel interior
#    (ejemplo con b2 y m_A5, replicar las que uses en la thesis)

b2_interior <- fepois(
  n_robos ~ n_schools * is_school_time + n_bus_stops * is_school_time + 
    n_police * is_school_time  + is_school_time * n_commercial ^2| grid_id + date,
  data    = crime_panel_interior,
  cluster = ~grid_id
)

m_A5_interior <- fepois(
  n_crimes ~ franja_4cat +
    i(franja_4cat, n_schools,     ref = "control") + 
    i(franja_4cat, n_bus_stops,   ref = "control") + 
    i(franja_4cat, n_police,      ref = "control") + 
    i(franja_4cat, n_commercial,  ref = "control") | grid_id + date,
  data    = crime_panel_interior,
  cluster = ~grid_id
)

# 5. Comparación directa full sample vs interior
etable(
  b2, b2_interior,
  headers = c("Full sample", "Interior grids only"),
  title   = "Robustness: Excluding border grids"
)



# =============================================================================
# ROBUSTNESS: Excluir border grids + escuelas en border grids
# ======================
schools_sf <- readRDS("schools_sf.rds")

# --- 1. Border grid IDs ---
caba_boundary <- st_union(barrios_sf) %>% st_transform(22174) %>% st_make_valid()
grid_proj     <- grid_500_caba %>% st_transform(22174) %>% st_make_valid()

interior_mask   <- st_within(grid_proj, caba_boundary, sparse = FALSE)[, 1]
border_grid_ids <- grid_proj$grid_id[!interior_mask]

cat(sprintf("Totales: %d | Borde: %d | Interior: %d\n",
            nrow(grid_proj), length(border_grid_ids), sum(interior_mask)))

# --- 2. Escuelas en grids de borde ---
# Join escuelas → grid, identificar cuáles caen en border grids
schools_grid <- st_join(
  schools_sf %>% st_transform(22174) %>% select(sector),
  grid_proj %>% select(grid_id),
  join = st_within
) %>%
  mutate(school_id = row_number())

border_school_ids <- schools_grid %>%
  st_drop_geometry() %>%
  filter(grid_id %in% border_grid_ids) %>%
  pull(school_id)

cat(sprintf("Escuelas totales: %d | En borde: %d | Interior: %d\n",
            nrow(schools_sf),
            length(border_school_ids),
            nrow(schools_sf) - length(border_school_ids)))

schools_interior <- schools_grid %>%
  filter(!school_id %in% border_school_ids)

# --- 3. Recalcular n_esc_buffer con escuelas interiores solamente ---
# Función corregida — sin el bug de geometry como columna
count_schools_buffer <- function(centroids, schools, radius) {
  buffers <- st_buffer(centroids, dist = radius)
  
  joined <- st_join(
    buffers %>% select(grid_id),
    schools %>% select(geometry),   # solo geometría, sin columnas extra
    join = st_contains
  )
  
  # Contar filas por grid_id — si no hay match el grid no aparece
  joined %>%
    st_drop_geometry() %>%
    group_by(grid_id) %>%
    summarise(n = n(), .groups = "drop")
}

BUFFER_RADII <- c(100, 150, 200, 300)

interior_buffer_vars <- grid_proj %>%
  st_drop_geometry() %>%
  select(grid_id)
schools_interior <- schools_interior %>% st_transform(22174)

for (r in BUFFER_RADII) {
  
  tmp <- count_schools_buffer(
    grid_proj %>% st_centroid() %>% select(grid_id),
    schools_interior,
    radius = r
  )
  colnames(tmp)[2] <- paste0("n_esc_int_", r, "m")
  
  # público/privado
  tmp_pub <- count_schools_buffer(
    grid_proj %>% st_centroid() %>% select(grid_id),
    schools_interior %>% filter(sector == "Estatal"),
    radius = r
  )
  colnames(tmp_pub)[2] <- paste0("n_pub_int_", r, "m")
  
  tmp_priv <- count_schools_buffer(
    grid_proj %>% st_centroid() %>% select(grid_id),
    schools_interior %>% filter(sector == "Privado"),
    radius = r
  )
  colnames(tmp_priv)[2] <- paste0("n_priv_int_", r, "m")
  
  interior_buffer_vars <- interior_buffer_vars %>%
    left_join(tmp,      by = "grid_id") %>%
    left_join(tmp_pub,  by = "grid_id") %>%
    left_join(tmp_priv, by = "grid_id")
  
  cat(sprintf("Buffer %dm: OK\n", r))
}

# NAs → 0 (grids sin escuelas en ese radio)
interior_buffer_vars <- interior_buffer_vars %>%
  mutate(across(starts_with("n_"), ~replace_na(., 0)))

stopifnot(nrow(interior_buffer_vars) == nrow(grid_proj))

# --- 4. Panel interior con variables recalculadas ---
cols_to_drop <- names(crime_panel_final)[str_detect(names(crime_panel_final),
                                                    "n_esc_buffer|n_pub_buffer|n_priv_buffer")]

crime_panel_interior <- crime_panel_weekday %>%
  filter(!grid_id %in% border_grid_ids) %>%
  select(-any_of(cols_to_drop)) %>%
  left_join(interior_buffer_vars, by = "grid_id")

stopifnot(n_distinct(crime_panel_interior$grid_id) == sum(interior_mask))



# =====================================
#  BUFFERS ROBUSTNESS CHECKS    
# =====================================

# M1: gradient espacial — efecto de proximidad a escuela por bin
k_dist1 <- fepois(n_crimes ~ i(franja_4cat, ref = "control") +
                    i(franja_4cat, i.dist_bin, ref = "control", ref2 = "300_plus") | 
                    grid_id + date,
                  data = crime_panel_interior, cluster = ~grid_id)
summary(k_dist1)

# m2: spatial gradient with controls
k_dist2 <- fepois(n_crimes ~ i(franja_4cat, ref = "control") +
                    i(franja_4cat, i.dist_bin, ref = "control", ref2 = "300_plus") +
                    i(franja_4cat, i.dist_bus_bin, ref = "control", ref2 = "300_plus") +
                    i(franja_4cat, i.dist_police_bin, ref = "control", ref2 = "300_plus")
                  | grid_id + date,
                  data = crime_panel_interior, 
                  cluster = ~grid_id)
summary(k_dist2)



# using school exposure
k_exp <- fepois(n_crimes ~ i(franja_4cat, ref = "control") +
                  i(franja_4cat, exposure_100m, ref = "control") +
                  i(franja_4cat, exposure_200m, ref = "control") +
                  i(franja_4cat, exposure_300m, ref = "control")| grid_id + date,
                data = crime_panel_final, cluster = ~grid_id)
summary(k_exp)

# M4: 
k_dist4 <- fepois(n_robos ~ franja_4cat +
                    i(franja_4cat, exposure_100m, ref = "control") +
                    i(franja_4cat, exposure_200m,  ref = "control") +
                    i(franja_4cat, exposure_300m, ref = "control") +
                    i(franja_4cat, i.dist_bus_bin, ref = "control", ref2 = "300_plus") +
                    i(franja_4cat, i.dist_police_bin, ref = "control", ref2 = "300_plus")
                  | grid_id + date,
                  data = crime_panel_interior, cluster = ~grid_id)
summary(k_dist4)

my_style <- style.tex(fontsize = "tiny")

etable(k_dist1, k_dist2,
       headers   = c("Baseline bins", "Control bins"),
       title     = "Border-grid robustness: distance-bin specifications",
       drop      = c("dist_bus_bin", "dist_police_bin"),
       dict      = c("franja_4catexit_primaria"   = "franja_4cat = exit_primaria",
                     "franja_4catexit_secundaria" = "franja_4cat = exit_secundaria",
                     "franja_4catstart"           = "franja_4cat = start"),
       style.tex = my_style,
       tex       = TRUE,
       file      = "tables/tab_border_bins.tex")

rename_franja <- function(x) {
  x <- gsub("^franja_4catexit_primaria$",   "franja_4cat = exit_primaria",   x)
  x <- gsub("^franja_4catexit_secundaria$", "franja_4cat = exit_secundaria", x)
  x <- gsub("^franja_4catstart$",           "franja_4cat = start",           x)
  x
}
names(coef(k_dist4))
etable(k_exp, k_dist4,
       headers   = c("Exposure baseline", "Exposure controls"),
       title     = "Border-grid robustness: exposure specifications",
       drop      = c("dist_bus_bin", "dist_police_bin"),
       dict      = c("franja_4catexit_primaria"   = "franja_4cat = exit_primaria",
                     "franja_4catexit_secundaria" = "franja_4cat = exit_secundaria",
                     "franja_4catstart"           = "franja_4cat = start",
                     "franja_4cat::exit_primaria"   = "franja_4cat = exit_primaria",
                     "franja_4cat::exit_secundaria" = "franja_4cat = exit_secundaria",
                     "franja_4cat::start"           = "franja_4cat = start"),
       order     = c("^franja_4cat = exit_primaria$",
                     "^franja_4cat = exit_secundaria$",
                     "^franja_4cat = start$",
                     "exposure"),
       style.tex = my_style,
       tex       = TRUE,
       file      = "tables/tab_border_exp.tex")


# robustness qith clusters table
etable(
  list(
    "n_crimes / grid"            = z_dist1,
    "n_crimes / barrio"          = z_dist1_barrio,
    "n_crimes / barrio + ctrl"   = z_dist2_barrio,
    "n_hurtos / grid"            = z_dist1_hurtos
  ),
  keep     = "dist_bin",
  digits   = 3,
  se.below = TRUE,
  title    = "Spatial Gradient: Robustness to Clustering and Outcome",
  tex      = TRUE,
  file     = "tables/tab_cluster_robustness.tex",
  replace  = TRUE
)

table(crime_panel_weekday$dist_bin)
