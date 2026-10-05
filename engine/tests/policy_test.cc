#include "bikesy_policy.h"
#include <iostream>
#include <stdexcept>
void require(bool b){if(!b)throw std::runtime_error("Policy test failed");}
int main(){
 using namespace bikesy;
 require(positive_grade_integral(0,100)==0);require(positive_grade_integral(-10,100)==0);
 require(positive_grade_integral(10,100)>positive_grade_integral(10,500));
 const double flat=200,undulating=200+4*(positive_grade_integral(-10,100)+positive_grade_integral(10,100));require(undulating>flat);
 // Reversal exchanges ascent and descent, never subtracts either uphill cost.
 require(positive_grade_integral(10,100)+positive_grade_integral(-10,100)==positive_grade_integral(-10,100)+positive_grade_integral(10,100));
 require(proves_disconnected({1},{2}));require(proves_disconnected({1|kOpen},{2}));
 require(!proves_disconnected({1|kOpen},{2|kOpen}));require(!proves_disconnected({1},{1|kOpen}));
 require(!proves_disconnected({1,2},{2}));require(!proves_disconnected({},{2}));
 std::cout<<"positive-only convex grade and conservative connectivity tests passed\n";
}
