/*

cool shadertoys:
https://www.shadertoy.com/view/XtyXzW

the idea here is to consider grids composed of subgrids
if you know that a pixel is inside grid x, which is composed of a 3x3 subgrid,
you can decide which subcells to swap for that grid, e.g.:
   I know this pixel is in grid x
   I know that grid x will swap subcells 1,1 with 2,0
   I know this pixel is in subcell 1,1
   then I have to swap it with the content of 2,0

----------------------

https://www.shadertoy.com/view/4dXBW2

haven't studied this one yet


commented shader to pick up again:
commented shader to pick up again:
commented shader to pick up again:
commented shader to pick up again:
- - - - - - - - - -
float sat( float t ) {
	return clamp( t, 0.0, 1.0 );
}

vec2 sat( vec2 t ) {
	return clamp( t, 0.0, 1.0 );
}

//remaps inteval [a;b] to [0;1]
float remap  ( float t, float a, float b ) {
	return sat( (t - a) / (b - a) );
}

//note: /\ t=[0;0.5;1], y=[0;1;0]
float linterp( float t ) {
	return sat( 1.0 - abs( 2.0*t - 1.0 ) );
}

vec3 spectrum_offset( float t ) {
	vec3 ret;
    // if t < 0.5 ? 0 : 1
	// two possibilities: lo = 1 & hi = 0  OR  lo = 0 && hi = 1
    float lo = step(t,0.5);
	float hi = 1.0-lo;
    
       // remap also clamps
	float w = linterp( remap( t, 1.0/6.0, 5.0/6.0 ) );
	float neg_w = 1.0-w;

	    
    
    // t = 0:       vec3(0,1,1) * vec3(1.0, 0.0, 1.0);  -->  return vec3(0.0, 0.0, 1.0);
    // t = 0.1:     vec3(0,1,1) * vec3(0.8, 0.2, 0.8);  -->  return vec3(0.0, 0.0, 1.0);
    // t = 0.2:     vec3(0,1,1) * vec3(0.6, 0.4, 0.6);
    // t = 0.3:     vec3(0,1,1) * vec3(0.4, 0.6, 0.4);
    // t = 0.4:     vec3(0,1,1) * vec3(0.2, 0.8, 0.2);
    // t = 0.5:     vec3(0,1,1) * vec3(0.0, 1.0, 0.0);
    // t = 0.6:     vec3(1,1,0) * vec3(0.2, 0.8, 0.2);
    // t = 0.7:     vec3(1,1,0) * vec3(0.4, 0.6, 0.4);
    // t = 0.8:     vec3(1,1,0) * vec3(0.6, 0.4, 0.6);
    // t = 0.9:     vec3(1,1,0) * vec3(0.8, 0.2, 0.8);
    // t = 1.0:     vec3(1,1,0) * vec3(1.0, 0.0, 1.0);
    
	ret = vec3(lo,1.0,hi) * vec3(neg_w, w, neg_w);
	return pow( ret, vec3(1.0/2.2) );
}

//note: [0;1]
float rand( vec2 n ) {
  return fract(sin(dot(n.xy, vec2(12.9898, 78.233)))* 43758.5453);
}

//note: [-1;1]
float srand( vec2 n ) {
	return rand(n) * 2.0 - 1.0;
}

// for example, x = 0.9 and num_levels = 5 =
// floor(0.9 * 5) / 5 = 4 / 5 = 0.8
// so basically it maps x into grid cells
float mytrunc( float x, float num_levels )
{
	return floor(x*num_levels) / num_levels;
}
vec2 mytrunc( vec2 x, float num_levels )
{
	return floor(x*num_levels) / num_levels;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	vec2 uv = fragCoord.xy / iResolution.xy;
    uv.y = uv.y;
	
    // time can be [0, roughly 0.3]
	//float time = mod(iTime*100.0, 32.0)/110.0; // + modelmat[0].x + modelmat[0].z;
	float time = mod(0.5*100.0, 32.0)/110.0; // + modelmat[0].x + modelmat[0].z;

    // the more you move the mouse to the right the higher the glitch effect
	//float GLITCH = 0.1 + iMouse.x / iResolution.x;
	float GLITCH = 0.35;
	
    // glitch clamped? why? at most should be [0.1, 1.1] 
	float gnm = sat( GLITCH );
	
    // I think rnd0 is a random value that remains equal for a set amount of time
    // float rnd0 = rand(  same_value_for_0.x_seconds  );
    float rnd0 = rand( mytrunc( vec2(time, time), 6.0 ) );
    
    // r0 = rndm value that remains equal for a set amount of time + (as high as glitch is, times 0.7)
    // r0 = rnd0 + (as high as glitch is, times 0.7)
	float r0 = sat((1.0-gnm)*0.7 + rnd0);
    // valore casuale generato da un vec2
    // rand ( vec2() )
    // il vec2 è : 
    //     vec2(
    //         uv.x mappato nella griglia 10 * (rndm equal for x time + as high as glitch is)
    //         time
    //     )
    // in pratica in un determinato frame, rnd1 è un valore casuale uguale per tutti i pixel
    // dentro la griglia trunc(uv.x, 10 * r0)
	
    // okay r0 indica la grandezza orizzontale della griglia 
    // float rnd1 = rand( vec2(mytrunc( uv.x, 10.0*r0 ), time) ); //horz
    float rnd1 = rand( vec2(mytrunc( uv.x, 10.0 ), time) ); //horz
    
    // 0.5 - 0.5 * glitch_clamp + rnd1
    // es. 0.5 - 0.5 * 0.1 + 0.7 = 1.15
    //     0.5 - 0.5 * 0.9 + 0.7 = 0.7
    // in pratica è un numero casuale fra [0.7 - 1.2]
    float r1 = 0.5 - 0.5 * gnm + rnd1;
    // questa linea sotto è equivalente a = 1 - clamp(r1, 0, 0.99999) 
	// r1 = 1.0 - max( 0.0, ((r1<1.0) ? r1 : 0.9999999) ); //note: weird ass bug on old drivers
	// in pratica mettiamo r1 fra [0.7 e 1.0]
    // e poi invertiamo
    r1 = 1.0 - clamp(r1, 0.0, 0.9999); //note: weird ass bug on old drivers
	
    // da questo punto in poi r1 è in [0 - 0.3]
    // in pratica r1 è UGUALE PER TUTTI I PIXEL NELLA STESSA COLONNA DEFINITA DA trunc(uv.x, 10*r0)
    // se elimini * r1 nello statement qui sotto, vedresti che il glitch varia solo nelle righe
    // mentre se moltiplichi per r1 che è uguale per ogni colonna, ottieni effettivamente una griglia
    float rnd2 = rand( vec2(mytrunc( uv.y, 40.0 * r1 ), time) ); //vert
    // r2 [0, 1]
    // R2 è UN VALORE DIVERSO PER OGNI CELLA DELLA GRIGLIA SU SCHERMO!
    // UN PIXEL X1,Y1 AVRA' LO STESSO VALORE DI X2,Y2 SE SONO NELLA STESSA CELLA!
	float r2 = sat( rnd2 );

    // questo viene usato solo sotto per incrementare uv.y
	//float rnd3 = rand( vec2(mytrunc( uv.y, 10.0*r0 ), time) );
	//float r3 = (1.0-sat(rnd3+0.8)) - 0.1;

    // questa linea crea l'effetto noise
	float pxrnd = rand( uv + time );
    pxrnd = 0.0;

	float ofs = 0.05 * r2 * GLITCH * ( rnd0 > 0.5 ? 1.0 : -1.0 );
    ofs += 0.5 * pxrnd * ofs;


	//uv.y += 0.1 * r3 * GLITCH;
    
    const int NUM_SAMPLES = 20;
    const float RCP_NUM_SAMPLES_F = 1.0 / float(NUM_SAMPLES);
    
	vec4 sum = vec4(0.0);
	vec3 wsum = vec3(0.0);
	for( int i=0; i<NUM_SAMPLES; ++i )
	{
		float t = float(i) * RCP_NUM_SAMPLES_F;
        // ad ogni iterazione avanza uv.x di ofs * t
        // quindi in pratica se ofs è 10, e ci sono 10 iterazioni, 
        // avanza uv.x di 1 ad ogni iterazione
		uv.x = sat( uv.x + ofs * t );
		vec4 samplecol = texture( iChannel0, uv, -100.0 );
        
        // t è semplicemente un valore fra [0, 1]
		vec3 s = spectrum_offset( t );
		samplecol.rgb = samplecol.rgb * s;
		sum += samplecol;
		wsum += s;
	}
	sum.rgb /= wsum;
	sum.a *= RCP_NUM_SAMPLES_F;

	fragColor.a = sum.a;
	fragColor.rgb = sum.rgb; // * outcol0.a;
}

*/

import * as THREE from "three";
import { saturate, remap, linterp, spectrum_offset, rand } from "./shaderFragments";

export default class Glitch {
    constructor(renderer, args) {
        if(!args) args = { };
        this.strength         = args.strength || 1;
        this.bottomDistortion = args.bottomDistortion || true;

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTexture:           { type: "t", value: null },
                uTime:              { value: 0 },
                uBottomDistortion:  { value: false },
                uStrength:          { value: 1 },
            },
            
            vertexShader: `
                varying vec2 vUv;

                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);    
                }
            `,

            fragmentShader: `
                uniform sampler2D uTexture;
                uniform float uTime;
                uniform float uStrength;
                uniform bool  uBottomDistortion;
                uniform float uDispersion;

                varying vec2 vUv;

                ${rand}
                ${saturate}
                ${remap}
                ${linterp}
                ${spectrum_offset}

                // vec4 block:  .xy bottomcoords - .zw topcoords
                float isInBlock(vec2 uv, vec4 block) {
                    vec2 a = sign(uv - block.xy);
                    vec2 b = sign(block.zw - uv);
                    return min(sign(a.x + a.y + b.x + b.y - 3.), 0.);
                }

                vec2 moveDiff(vec2 uv, vec4 swapA, vec4 swapB) {
                    vec2 diff = swapB.xy - swapA.xy;
                    return diff * isInBlock(uv, swapA);
                }

                vec2 randSwap(
                    vec2 uv, 
                    vec2 gridSize, /* in uv space */
                    vec2 subGridSize, /* e.g. vec2(3, 3) for a 3x3 grid */ 
                    float time,
                    inout float dispersion
                ) {
                    vec2 gridBottom = uv - mod(uv, gridSize);
                    vec2 gridCenter = gridBottom + gridSize * 0.5;

                    if(uBottomDistortion) {
                        uv.y += srand(gridBottom) * 0.025;
                    }

                    float subGridCellsCount = subGridSize.x * subGridSize.y;

                    float gridRand1 = rand(gridCenter + vec2(time));
                    float gridRand2 = rand(gridBottom + vec2(time));

                    dispersion += srand(gridBottom + vec2(time)) * (gridSize.x + gridSize.y);

                    float randSubGridIdx1 = floor( gridRand1 * subGridCellsCount  );
                    float randSubGridIdx2 = floor( gridRand2 * subGridCellsCount  );

                    vec2 subCellSize = gridSize / subGridSize;
                    
                    vec2 scell1Bottom = gridBottom + vec2(
                        mod(randSubGridIdx1, subGridSize.x) * subCellSize.x,
                        floor(randSubGridIdx1 / subGridSize.x) * subCellSize.y
                    );
                    vec2 scell2Bottom = gridBottom + vec2(
                        mod(randSubGridIdx2, subGridSize.x) * subCellSize.x,
                        floor(randSubGridIdx2 / subGridSize.x) * subCellSize.y
                    );
                    
                    vec4 swapA = vec4(scell1Bottom, scell1Bottom + subCellSize);
                    vec4 swapB = vec4(scell2Bottom, scell2Bottom + subCellSize);

                    vec2 newUv = uv;
                    // if we're in swapA, move to swapB
                    newUv += moveDiff(uv, swapA, swapB);
                    // if we're in swapB, move to swapA
                    newUv += moveDiff(uv, swapB, swapA);
                    return newUv;
                }

                void main() {

                    float time = uTime;
                    float dispersion = 0.0;
                    float nullop = 0.0; // we'll use this value instead of dispersion just because the compiler complaints if I don't do it

                    vec2 uv = randSwap(vUv, vec2(0.40 + vUv.x * 0.0000025, 0.20),  vec2(3.0, 3.0), time - mod(time, 0.15), dispersion);
                    uv      = randSwap(uv,  vec2(0.02 + uv.x  * 0.0000025, 0.015), vec2(3.0, 2.0), time - mod(time, 0.05), nullop);
                    uv      = randSwap(uv,  vec2(0.06 + uv.x  * 0.0000025, 0.12),  vec2(2.0, 3.0), time - mod(time, 0.02), nullop);
                    uv      = randSwap(uv,  vec2(0.35 + uv.x  * 0.0000025, 0.35),  vec2(2.0, 2.0), time - mod(time, 0.07), dispersion);

                    vec2 dist = vUv - uv;
                    uv += dist * (1.0 - uStrength);
                    dispersion = sat(dispersion) * uStrength * 15.0;


                    float direction = rand(vec2(dispersion)) > 0.5 ? -1.0 : 1.0;
                    const int steps = 10;
                    vec3 sum = vec3(0.0);
                    vec3 cumw = vec3(0.0);

                    // rand pixel offset to ease dispersion a bit
                    uv.x += srand(uv) * 0.01 * dispersion;

                    for(int i = 0; i < steps; i++) {
                        float t = float(i) / float(steps);
                        vec2 dispUv = uv + vec2(dispersion * 0.1 * direction * t, 0.0);
                        vec3 spectr = spectrum_offset(t);
                        cumw += spectr;
                        sum += texture2D(uTexture, dispUv).rgb * spectr;
                    }

                    gl_FragColor = vec4(sum / cumw, 1.0);
                }
            `,

            depthTest:  false,
            depthWrite: false,
        });

        this.mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(2,2), this.material);
        this.camera = new THREE.PerspectiveCamera( 45, 1 /* remember that the camera is worthless here */, 1, 1000 );
        this.renderer = renderer;

        this.scene = new THREE.Scene();
        this.scene.add(this.mesh);
    }

    compute(time, renderTargetFrom, renderTargetDest) {
        this.renderer.setRenderTarget(renderTargetDest);

        this.material.uniforms.uTexture.value  = renderTargetFrom.texture;
        this.material.uniforms.uTime.value     = time;
        this.material.uniforms.uStrength.value = this.strength;
        this.material.uniforms.uBottomDistortion.value = this.bottomDistortion;
        this.renderer.render(this.scene, this.camera);

        this.renderer.setRenderTarget(null);
    }
}