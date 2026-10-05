// Shared by the experimental viewer and Node regression tests. Geometry-based
// notices supplement (not replace) exact graph access checks and opening hours.
(function (root) {
  root.BikesyBridgeNotices = function ({ points = [], start, end, walking = false }) {
    const notices = [];
    const extent = ([south, west, north, east]) => {
      const ps = points.filter(([lat, lon]) => lat >= south && lat <= north && lon >= west && lon <= east);
      return ps.length ? { lat: Math.max(...ps.map(p => p[0])) - Math.min(...ps.map(p => p[0])), lon: Math.max(...ps.map(p => p[1])) - Math.min(...ps.map(p => p[1])) } : {lat:0,lon:0};
    };
    if (extent([37.807,-122.487,37.834,-122.470]).lat > .012)
      notices.push({code:'golden_gate',text:'Golden Gate Bridge: use the signed bicycle sidewalk, never the vehicle lanes. The open side changes with the schedule and closures; check current access before riding.',url:'https://www.goldengate.org/bridge/visiting-the-bridge/bikes-pedestrians/'});
    if (extent([38.053,-122.236,38.069,-122.223]).lat > .008)
      notices.push({code:'carquinez',text:'Carquinez Bridge: use the shared path on the western Alfred Zampa span in either direction, not the vehicle lanes.',url:'https://511.org/travel/bridges/carquinez-bridge'});
    if (extent([37.805,-122.370,37.837,-122.290]).lon > .004)
      notices.push({code:'bay_east',text:'Bay Bridge East Span: the path reaches Yerba Buena Island, but does not continue over the West Span to San Francisco. Check current path hours and island construction access.',url:'https://511.org/travel/bridges/san-francisco-oakland-bay-bridge'});
    const sf = p => p && p[0] > 37.70 && p[0] < 37.83 && p[1] < -122.375;
    const east = p => p && p[0] > 37.75 && p[0] < 37.89 && p[1] > -122.370;
    if ((sf(start) && east(end)) || (sf(end) && east(start)))
      notices.push({code:'bay_no_through',text:'There is no bicycle crossing of the entire Bay Bridge between San Francisco and Oakland. Review the full route: a land detour can be much longer. Bike-friendly transit is another option.',url:'https://511.org/travel/biking-walking/access/bridges'});
    if (walking) notices.push({code:'walk_bicycle',text:'This route includes walking sections. Dismount where indicated; stairs may require carrying your bicycle.'});
    return notices;
  };
})(globalThis);
