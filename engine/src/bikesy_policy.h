#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <stdexcept>
#include <unordered_map>
#include <vector>
#include "baldr/graphreader.h"
#include "proto/common.pb.h"

namespace bikesy {
constexpr uint64_t kMagic = 0x31594c4f50594b42ULL; // BKYPOLY1, little-endian format v1
constexpr uint32_t kOpen = 0x80000000u;
struct Tile { uint64_t id; uint32_t nodes, node_count, edges, edge_count; };
static_assert(sizeof(Tile)==24);
// Meter integral. Downhill contributes exactly zero, never credit.
inline double positive_grade_integral(double rise, double run) {
  if (!(run > 0) || !std::isfinite(rise) || !std::isfinite(run))
    throw std::runtime_error("Invalid Bikesy elevation segment");
  const double g=std::max(0.0,rise/run)/0.05;
  return run*g*g*g;
}
inline bool proves_disconnected(const std::vector<uint32_t>& a,const std::vector<uint32_t>& b) {
  if(a.empty()||b.empty())return false;
  for(auto x:a)for(auto y:b)
    if((x&~kOpen)==(y&~kOpen) || ((x&kOpen)&&(y&kOpen)))return false;
  return true;
}
class Policy {
  std::unordered_map<uint64_t,Tile> tiles_;
  std::vector<uint32_t> components_;
  std::vector<float> uphill_;
public:
  Policy() {
    const char* name=std::getenv("BIKESY_POLICY_DATA");
    if(!name)throw std::runtime_error("Missing verified Bikesy policy dataset");
    std::ifstream f(name,std::ios::binary);uint64_t magic=0;uint32_t nt=0,nn=0,ne=0;
    f.read(reinterpret_cast<char*>(&magic),8);f.read(reinterpret_cast<char*>(&nt),4);f.read(reinterpret_cast<char*>(&nn),4);f.read(reinterpret_cast<char*>(&ne),4);
    if(!f||magic!=kMagic||nt>10000||nn>10000000||ne>30000000)throw std::runtime_error("Invalid Bikesy policy dataset");
    for(uint32_t i=0;i<nt;++i){Tile t;f.read(reinterpret_cast<char*>(&t),sizeof t);if(uint64_t(t.nodes)+t.node_count>nn||uint64_t(t.edges)+t.edge_count>ne||!tiles_.emplace(t.id,t).second)throw std::runtime_error("Invalid Bikesy tile index");}
    components_.resize(nn);uphill_.resize(ne);f.read(reinterpret_cast<char*>(components_.data()),nn*4);f.read(reinterpret_cast<char*>(uphill_.data()),ne*4);
    if(!f||f.peek()!=std::char_traits<char>::eof())throw std::runtime_error("Incomplete Bikesy policy dataset");
    for(float v:uphill_)if(!std::isfinite(v)||v<0)throw std::runtime_error("Invalid Bikesy uphill cost");
  }
  float uphill(const valhalla::baldr::DirectedEdge* edge,const valhalla::baldr::graph_tile_ptr& tile) const {
    auto it=tiles_.find(tile->id().value);if(it==tiles_.end())throw std::runtime_error("Unverified Bikesy tile");
    auto idx=edge-tile->directededge(0);if(idx<0||uint64_t(idx)>=it->second.edge_count)throw std::runtime_error("Invalid Bikesy edge");
    return uphill_[it->second.edges+idx];
  }
  bool disconnected(const valhalla::Location& a,const valhalla::Location& b,valhalla::baldr::GraphReader& reader) const {
    auto comps=[&](const valhalla::Location& location){
      std::vector<uint32_t> out;
      auto collect=[&](const auto& edges){for(const auto& candidate:edges){
        valhalla::baldr::GraphId id(candidate.graph_id());auto tile=reader.GetGraphTile(id);
        if(!tile)throw std::runtime_error("Missing certificate tile");
        auto edge=tile->directededge(id);
        if(edge->use()==valhalla::baldr::Use::kFerry||edge->use()==valhalla::baldr::Use::kRailFerry)throw std::runtime_error("Ferry candidate in land pass");
        auto node=edge->endnode();auto it=tiles_.find(node.Tile_Base().value);
        if(it==tiles_.end()||node.id()>=it->second.node_count)throw std::runtime_error("Missing certificate node");
        out.push_back(components_[it->second.nodes+node.id()]);
      }};
      collect(location.correlation().edges());collect(location.correlation().filtered_edges());return out;
    };
    return proves_disconnected(comps(a),comps(b));
  }
};
inline const Policy& policy(){static const Policy p;return p;}
}
