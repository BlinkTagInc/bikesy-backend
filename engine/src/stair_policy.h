#pragma once
#include "baldr/graphreader.h"
#include <unordered_map>
#include <fstream>
#include <cstdlib>
#include <cmath>
#include <stdexcept>
namespace bikesy {
class StairPolicy {
 std::unordered_map<uint64_t,float> penalties_;
public:
 StairPolicy(){const char* path=std::getenv("BIKESY_STAIRS_DATA");if(!path)throw std::runtime_error("Missing verified stair dataset");std::ifstream in(path);std::string magic;size_t n;in>>magic>>n;if(!in||magic!="BIKESY_STAIRS_V1"||n==0||n>1000000)throw std::runtime_error("Invalid stair dataset");for(size_t i=0;i<n;++i){uint64_t id;float cost;in>>id>>cost;if(!in||!std::isfinite(cost)||cost<0||!penalties_.emplace(id,cost).second)throw std::runtime_error("Invalid stair record");}std::string extra;if(in>>extra)throw std::runtime_error("Trailing stair data");}
 float penalty(const valhalla::baldr::DirectedEdge* edge,const valhalla::baldr::graph_tile_ptr& tile)const{auto idx=edge-tile->directededge(0);auto id=valhalla::baldr::GraphId(tile->id().tileid(),tile->id().level(),idx);auto it=penalties_.find(id.value);if(it==penalties_.end())throw std::runtime_error("Stair edge missing verified metadata");return it->second;}
};
inline const StairPolicy& stairs(){static const StairPolicy value;return value;}
}
