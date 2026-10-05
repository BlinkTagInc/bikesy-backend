#include "bikesy_policy.h"
#include "config.h"
#include "sif/bicyclecost.h"
#include "sif/dynamiccost.h"
#include "skadi/sample.h"
#include "midgard/util.h"
#include <iostream>
#include <iomanip>
using namespace valhalla;using namespace baldr;
sif::cost_ptr_t model(float r,float h){Costing c;rapidjson::Document d;std::string s="{\"bicycle\":{\"bicycle_type\":\"Hybrid\",\"use_roads\":"+std::to_string(r)+",\"use_hills\":"+std::to_string(h)+",\"use_ferry\":0,\"maneuver_penalty\":2}}";d.Parse(s.c_str());sif::ParseBicycleCostOptions(d,"/bicycle",&c);return sif::CreateBicycleCost(c);}
int main(int argc,char**argv){try{
 auto cfg=valhalla::config(argv[1]);GraphReader reader(cfg.get_child("mjolnir"));skadi::sample dem(cfg.get<std::string>("additional_data.elevation"));auto direct=model(1,0),balanced=model(.5,1),friendly=model(0,1);uint64_t v;std::cout<<std::setprecision(12);
 while(std::cin>>v){GraphId id(v);auto tile=reader.GetGraphTile(id);auto e=tile->directededge(id);uint8_t flow=0;double H=bikesy::policy().uphill(e,tile);double other=direct->EdgeCost(e,tile,TimeInfo::invalid(),flow).cost-e->length()-4*H;
  auto shape=tile->edgeinfo(e).shape();auto sample=midgard::uniform_resample_spherical_polyline(shape,double(e->length()),std::max(2u,uint32_t(std::ceil(e->length()/30.))+1));auto hs=dem.get_all(sample);
  if(e->bridge()||e->tunnel())for(size_t i=1;i+1<hs.size();++i)hs[i]=hs.front()+(hs.back()-hs.front())*double(i)/(hs.size()-1);
  if(!e->forward())std::reverse(hs.begin(),hs.end());double asc=0,desc=0,g5=0,g8=0,g10=0,g15=0,check=0,ds=double(e->length())/(hs.size()-1);
  for(size_t i=1;i<hs.size();++i){double dh=hs[i]-hs[i-1];asc+=std::max(0.,dh);desc+=std::max(0.,-dh);if(dh/ds>.05)g5+=ds;if(dh/ds>.08)g8+=ds;if(dh/ds>.10)g10+=ds;if(dh/ds>.15)g15+=ds;check+=bikesy::positive_grade_integral(dh,ds);}
  std::cout<<v<<" "<<e->length()<<" "<<H<<" "<<other<<" "<<balanced->EdgeCost(e,tile,TimeInfo::invalid(),flow).cost-e->length()-other<<" "<<friendly->EdgeCost(e,tile,TimeInfo::invalid(),flow).cost-e->length()-other<<" "<<asc<<" "<<desc<<" "<<g5<<" "<<g8<<" "<<g10<<" "<<g15<<" "<<check<<" "<<unsigned(e->speed())<<" "<<unsigned(e->lanecount())<<" "<<e->dismount()<<" "<<e->forwardaccess()<<" "<<e->reverseaccess()<<"\n";
 }
}catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}}
