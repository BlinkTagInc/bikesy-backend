#!/bin/sh
set -eu
mkdir -p out
CXXFLAGS='-std=c++17 -O2 -DNDEBUG -DENABLE_SERVICES -DENABLE_HTTP -DENABLE_LZ4 -DVALHALLA_VERSION_MAJOR=3 -DVALHALLA_VERSION_MINOR=5 -DVALHALLA_VERSION_PATCH=1 -I/usr/local/include/valhalla/third_party -I/usr/local/include -I/usr/local/include/valhalla -Isrc'
g++ $CXXFLAGS -c src/bicyclecost.cc -o out/bicyclecost.cc.o
g++ $CXXFLAGS -c src/route_action.cc -o out/route_action.cc.o
LIBS='out/bicyclecost.cc.o out/route_action.cc.o /usr/local/lib/libvalhalla.a -L/usr/local/lib -lprime_server -lprotobuf-lite -lcurl -llz4 -lz -lzmq -lczmq -lpthread -l:libgdal.so.34'
g++ $CXXFLAGS upstream/src/valhalla_service.cc $LIBS -o out/valhalla_service
g++ $CXXFLAGS src/build_policy.cc $LIBS -o out/build_policy
g++ $CXXFLAGS tests/policy_test.cc $LIBS -o out/policy_test
out/policy_test
g++ $CXXFLAGS tests/engine_cost_test.cc $LIBS -o out/engine_cost_test
g++ $CXXFLAGS tests/access_audit.cc $LIBS -o out/access_audit
g++ $CXXFLAGS src/apply_access.cc $LIBS -o out/apply_access
g++ $CXXFLAGS tests/validate_access.cc $LIBS -o out/validate_access
g++ $CXXFLAGS tests/local_graph.cc $LIBS -o out/local_graph
g++ $CXXFLAGS tests/ferry_audit.cc $LIBS -o out/ferry_audit
sha256sum out/valhalla_service out/build_policy out/policy_test

for name in graph_quality route_edge_metrics export_country; do
  g++ $CXXFLAGS "tests/$name.cc" $LIBS -o "out/$name"
done
