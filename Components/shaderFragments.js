let saturate = `
float sat( float t ) {
	return clamp( t, 0.0, 1.0 );
}

vec2 sat( vec2 t ) {
	return clamp( t, 0.0, 1.0 );
}`;

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 

let remap = `
//remaps inteval [a;b] to [0;1]
float remap ( float t, float a, float b ) {
	return sat( (t - a) / (b - a) );
}`;

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 

let linterp = `
//note: /\ t=[0; 0.5; 1], y=[0; 1; 0]
float linterp( float t ) {
	return sat( 1.0 - abs( 2.0*t - 1.0 ) );
}
`;

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 

// **** REQUIRES ****:   remap, linterp
let spectrum_offset = `
// given t = [0, 1] 
// if t < 0.5    lo = 0 & hi = 1  else  lo = 1 && hi = 0
// 'w' will take the form:  [0, 1, 0] and 'neg_w' = [1, 0, 1]
vec3 spectrum_offset( float t ) {
	vec3 ret;
    // remember that t is the edge, not 0.5... so it's a bit confusing since normally you'd expect
    // for this call to be written as: step(0.5 /* edge */, t /* x */) as per the specs on:
    // https://www.khronos.org/registry/OpenGL-Refpages/gl4/html/step.xhtml
    float lo = step(t, 0.5);
	float hi = 1.0-lo;
    
    // float w = linterp( remap( t, 0.166, 0.833 ) );
    float w = linterp( t );
	float neg_w = 1.0 - w;
    
    // t = 0:       vec3(0,1,1)     * vec3(1.0, 0.0, 1.0);  -->  return vec3(0.0, 0.0, 1.0);
    // t = 0.1:     vec3(0,1,1)     * vec3(0.8, 0.2, 0.8);  -->  return vec3(0.0, 0.2, 0.8);
    // t = 0.2:     vec3(0,1,1)     * vec3(0.6, 0.4, 0.6);  -->  return vec3(0.0, 0.4, 0.6);
    // t = 0.3:     vec3(0,1,1)     * vec3(0.4, 0.6, 0.4);  -->  return vec3(0.0, 0.6, 0.4);
    // t = 0.4:     vec3(0,1,1)     * vec3(0.2, 0.8, 0.2);  -->  return vec3(0.0, 0.8, 0.2);
    // t = 0.5:     vec3(0,1,1)     * vec3(0.0, 1.0, 0.0);  -->  return vec3(0.0, 1.0, 0.0);
    // t = 0.6:     vec3(1,1,0)     * vec3(0.2, 0.8, 0.2);  -->  return vec3(0.2, 0.8, 0.0);
    // t = 0.7:     vec3(1,1,0)     * vec3(0.4, 0.6, 0.4);  -->  return vec3(0.4, 0.6, 0.0);
    // t = 0.8:     vec3(1,1,0)     * vec3(0.6, 0.4, 0.6);  -->  return vec3(0.6, 0.4, 0.0);
    // t = 0.9:     vec3(1,1,0)     * vec3(0.8, 0.2, 0.8);  -->  return vec3(0.8, 0.2, 0.0);
    // t = 1.0:     vec3(1,1,0)     * vec3(1.0, 0.0, 1.0);  -->  return vec3(1.0, 0.0, 0.0);
	ret =           vec3(lo,1.0,hi) * vec3(neg_w, w, neg_w);
	// return pow( ret, vec3(1.0/2.2) );
	return ret;
}
`;

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 

let rand = `
// note: [0;1]
float rand( vec2 n ) {
    return fract(sin(dot(n.xy, vec2(12.9898, 78.233)))* 43758.5453);
}
  
// note: [-1;1]
float srand( vec2 n ) {
    return rand(n) * 2.0 - 1.0;
}
`;  

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 

export {
    saturate, 
    remap, 
    linterp,
    spectrum_offset,
    rand,
};