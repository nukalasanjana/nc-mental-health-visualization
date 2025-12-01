// js/app.js
console.log("✅ app.js loaded, D3 version:", d3.version);

// DOM references
const mapSvg       = d3.select("#map");
const scatterSvg   = d3.select("#scatter");
const tooltip      = d3.select("#tooltip");
const detailsTitle = d3.select("#county-title");
const detailsBox   = d3.select("#county-details");

let scatterData = [];

// Load CSV + GeoJSON
Promise.all([
  d3.csv("data/NC_D3_Data.csv"),
  d3.json("data/nc-counties.geojson")
]).then(([rows, geo]) => {
    console.log("✅ Promise resolved");
console.log("Rows loaded from CSV:", rows.length);
console.log("GeoJSON type:", geo.type);
console.log("GeoJSON features:", geo.features ? geo.features.length : "NO FEATURES");

  // --- 1. Clean up CSV values / types ---
  rows.forEach(d => {
    d.DEPRESSION_AdjPrev   = +d["DEPRESSION_AdjPrev"];   // age-adjusted %
    d.DEPRESSION_CrudePrev = +d["DEPRESSION_CrudePrev"]; // crude %
    d.TotalPopulation      = +d["TotalPopulation"];
    d.TotalPop18plus       = +d["TotalPop18plus"];
    d.MedianIncome         = +d["MedianIncome"];
    d.PovertyRate          = +d["PovertyRate"];
    d.CountyFIPS           = d["CountyFIPS"].toString().padStart(5, "0"); // e.g. 37001
  });

  const byFips = new Map(rows.map(d => [d.CountyFIPS, d]));

  // --- 2. Use your GeoJSON features ---
  const counties = geo.features;

  // Your properties look like:
  // { County: 'Alamance', FIPS: '001', ... }
  // We need to convert '001' -> '37001' to match CountyFIPS.
  function getFipsFromFeature(f) {
    const props = f.properties || {};
    if (props.GEOID) {
      return String(props.GEOID).padStart(5, "0");
    }
    if (props.FIPS) {
      // FIPS is 3-digit county code; NC state code is 37
      return ("37" + String(props.FIPS).padStart(3, "0"));
    }
    if (props.COUNTYFP) {
      return ("37" + String(props.COUNTYFP).padStart(3, "0"));
    }
    if (f.id != null) {
      return String(f.id).padStart(5, "0");
    }
    return "";
  }

  // Projection (use fixed size to avoid flexbox weirdness)
  const mapWidth  = 800;
  const mapHeight = 600;

  const projection = d3.geoMercator()
    .fitSize([mapWidth, mapHeight], {
      type: "FeatureCollection",
      features: counties
    });

  const path = d3.geoPath().projection(projection);


  // --- 3. Scales for depression hotspot encoding ---
  const depExtent = d3.extent(rows, d => d.DEPRESSION_AdjPrev);
  const color = d3.scaleSequential(d3.interpolateReds).domain(depExtent);

  drawMap(counties, byFips, getFipsFromFeature, path, color, depExtent);
  drawScatter(rows);
}).catch(err => {
  console.error("Error loading data or geojson:", err);
});

/**
 * Draw NC map with depression hotspots colored by county
 */
function drawMap(counties, byFips, getFipsFromFeature, path, color, depExtent) {
  mapSvg.selectAll("*").remove();

  const container = mapSvg.node();
  const w = 800;
  const h = 600;

  // Create defs for gradients (must be at SVG level)
  const defs = mapSvg.append("defs");

  const g = mapSvg
    .attr("viewBox", `0 0 ${w} ${h}`)
    .append("g");

  // County polygons colored by depression rate
  g.selectAll("path")
    .data(counties)
    .join("path")
    .attr("d", path)
    .attr("class", d => {
      const fips = getFipsFromFeature(d);
      const row = byFips.get(fips);
      return row ? `county-path county-${row.CountyName.replace(/\s+/g, '-')}` : "county-path";
    })
    .attr("data-county", d => {
      const fips = getFipsFromFeature(d);
      const row = byFips.get(fips);
      return row ? row.CountyName : "";
    })
    .attr("fill", d => {
      const fips = getFipsFromFeature(d);
      const row = byFips.get(fips);
      return row ? color(row.DEPRESSION_AdjPrev) : "#f5f5f5";
    })
    .attr("stroke", "#fff")
    .attr("stroke-width", 0.5)
    .style("cursor", "pointer")
    .on("mouseover", function (event, d) {
      const fips = getFipsFromFeature(d);
      const row = byFips.get(fips);
      if (!row) return;
      d3.select(this).attr("stroke-width", 2).attr("stroke", "#333");

      tooltip
        .style("opacity", 1)
        .html(`
          <strong>${row.CountyName} County</strong><br/>
          Depression (age-adj): ${row.DEPRESSION_AdjPrev.toFixed(1)}%<br/>
          Depression (crude): ${row.DEPRESSION_CrudePrev.toFixed(1)}%<br/>
          Population: ${row.TotalPopulation.toLocaleString()}<br/>
          Median income: $${row.MedianIncome.toLocaleString()}<br/>
          Poverty rate: ${row.PovertyRate.toFixed(1)}%
        `)
        .style("left", (event.pageX + 10) + "px")
        .style("top",  (event.pageY + 10) + "px");
    })
    .on("mousemove", (event) => {
      tooltip
        .style("left", (event.pageX + 10) + "px")
        .style("top",  (event.pageY + 10) + "px");
    })
    .on("mouseout", function (event, d) {
      d3.select(this).attr("stroke-width", 0.5).attr("stroke", "#fff");
      tooltip.style("opacity", 0);
    })
    .on("click", (event, d) => {
      const fips = getFipsFromFeature(d);
      const row = byFips.get(fips);
      if (row) {
        updateCountyDetails(row);
        highlightScatter(row.CountyName);
        highlightCountyOnMap(row.CountyName);
      }
    });

  // Draw color legend
  drawColorLegend(g, color, depExtent, w, h, defs);
}

/**
 * Update the details panel
 */
function updateCountyDetails(row) {
  detailsTitle.text(`${row.CountyName} County`);

  detailsBox.html(`
    <p><strong>Depression (age-adjusted):</strong> ${row.DEPRESSION_AdjPrev.toFixed(1)}%</p>
    <p><strong>Depression (crude):</strong> ${row.DEPRESSION_CrudePrev.toFixed(1)}%</p>
    <p><strong>Total population:</strong> ${row.TotalPopulation.toLocaleString()}</p>
    <p><strong>Median income:</strong> $${row.MedianIncome.toLocaleString()}</p>
    <p><strong>Poverty rate:</strong> ${row.PovertyRate.toFixed(1)}%</p>
  `);
}

/**
 * Draw correlation scatterplot: income vs depression (age-adjusted)
 */
function drawScatter(rows) {
  scatterData = rows;

  const svg = scatterSvg;
  svg.selectAll("*").remove();

  const margin = { top: 20, right: 20, bottom: 40, left: 50 };
  const fullWidth  = svg.node().clientWidth  || 360;
  const fullHeight = svg.node().clientHeight || 260;
  const width  = fullWidth  - margin.left - margin.right;
  const height = fullHeight - margin.top  - margin.bottom;

  const g = svg
    .attr("viewBox", `0 0 ${fullWidth} ${fullHeight}`)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const filtered = rows.filter(d =>
    !isNaN(d.MedianIncome) && !isNaN(d.DEPRESSION_AdjPrev)
  );

  const x = d3.scaleLinear()
    .domain(d3.extent(filtered, d => d.MedianIncome)).nice()
    .range([0, width]);

  const y = d3.scaleLinear()
    .domain(d3.extent(filtered, d => d.DEPRESSION_AdjPrev)).nice()
    .range([height, 0]);

  // Axes
  g.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(
      d3.axisBottom(x)
        .ticks(5)
        .tickFormat(d => `$${(d/1000).toFixed(0)}k`)
    );

  g.append("g")
    .call(
      d3.axisLeft(y)
        .ticks(5)
        .tickFormat(d => d + "%")
    );

  // Axis labels
  g.append("text")
    .attr("x", width / 2)
    .attr("y", height + 32)
    .attr("text-anchor", "middle")
    .style("font-size", 11)
    .text("Median household income");

  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -38)
    .attr("text-anchor", "middle")
    .style("font-size", 11)
    .text("Depression (age-adjusted, %)");

  // Points
  g.selectAll("circle")
    .data(filtered)
    .join("circle")
    .attr("class", "scatter-point")
    .attr("cx", d => x(d.MedianIncome))
    .attr("cy", d => y(d.DEPRESSION_AdjPrev))
    .attr("r", 4)
    .attr("fill", "#3182bd")
    .attr("opacity", 0.8)
    .style("cursor", "pointer")
    .on("mouseover", (event, d) => {
      tooltip
        .style("opacity", 1)
        .html(`
          <strong>${d.CountyName} County</strong><br/>
          Depression: ${d.DEPRESSION_AdjPrev.toFixed(1)}%<br/>
          Income: $${d.MedianIncome.toLocaleString()}
        `)
        .style("left", (event.pageX + 10) + "px")
        .style("top",  (event.pageY + 10) + "px");
    })
    .on("mouseout", () => tooltip.style("opacity", 0))
    .on("click", (event, d) => {
      updateCountyDetails(d);
      highlightScatter(d.CountyName);
      highlightCountyOnMap(d.CountyName);
    });
}

/**
 * Highlight scatterpoint when its county is selected on map
 */
function highlightScatter(countyName) {
  scatterSvg.selectAll(".scatter-point")
    .attr("fill", d => d.CountyName === countyName ? "#e74c3c" : "#3182bd")
    .attr("stroke", d => d.CountyName === countyName ? "#c0392b" : "none")
    .attr("stroke-width", d => d.CountyName === countyName ? 1.5 : 0)
    .attr("r", d => d.CountyName === countyName ? 7 : 4);
}

/**
 * Highlight county on map when selected from scatter plot
 */
function highlightCountyOnMap(countyName) {
  // Reset all counties to default stroke
  mapSvg.selectAll(".county-path")
    .attr("stroke", "#fff")
    .attr("stroke-width", 0.5);
  
  // Highlight the selected county
  const countySelector = `.county-path[data-county="${countyName}"]`;
  mapSvg.selectAll(countySelector)
    .attr("stroke", "#000")
    .attr("stroke-width", 3);
}

/**
 * Draw color legend for depression rate scale
 */
function drawColorLegend(g, color, depExtent, mapWidth, mapHeight, defs) {
  const legendWidth = 200;
  const legendHeight = 20;
  const legendX = mapWidth - legendWidth - 20;
  const legendY = 20;
  const numSteps = 50;

  // Create gradient definition
  const gradient = defs.append("linearGradient")
    .attr("id", "color-gradient")
    .attr("x1", "0%")
    .attr("x2", "100%");

  // Create gradient stops
  const stepSize = (depExtent[1] - depExtent[0]) / numSteps;
  for (let i = 0; i <= numSteps; i++) {
    const value = depExtent[0] + (stepSize * i);
    gradient.append("stop")
      .attr("offset", `${(i / numSteps) * 100}%`)
      .attr("stop-color", color(value));
  }

  // Draw legend rectangle with gradient
  const legendGroup = g.append("g")
    .attr("class", "legend")
    .attr("transform", `translate(${legendX}, ${legendY})`);

  legendGroup.append("rect")
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .attr("fill", "url(#color-gradient)")
    .attr("stroke", "#333")
    .attr("stroke-width", 1);

  // Add title
  legendGroup.append("text")
    .attr("x", legendWidth / 2)
    .attr("y", -5)
    .attr("text-anchor", "middle")
    .style("font-size", "12px")
    .style("font-weight", "600")
    .text("Depression Rate (%)");

  // Add scale labels
  const scale = d3.scaleLinear()
    .domain(depExtent)
    .range([0, legendWidth]);

  const axis = d3.axisBottom(scale)
    .ticks(5)
    .tickFormat(d => d.toFixed(1) + "%");

  legendGroup.append("g")
    .attr("transform", `translate(0, ${legendHeight})`)
    .style("font-size", "10px")
    .call(axis);
}
