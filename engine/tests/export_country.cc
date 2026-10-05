#include "mjolnir/adminconstants.h"
#include <iostream>
int main(){bool comma=false;std::cout<<'[';for(int v:valhalla::mjolnir::kCountryAccess.at("United States")){if(comma)std::cout<<',';comma=true;std::cout<<v;}std::cout<<"]\n";}
