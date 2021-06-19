import * as THREE from "three";

const width  = 2;
const height = 2;
const size = width * height;


// default white texture
const dwtd = new Uint8Array( 3 * size );
for ( let i = 0; i < size; i ++ ) {
    dwtd[ i * 3 + 0 ] = 255;
    dwtd[ i * 3 + 1 ] = 255;
    dwtd[ i * 3 + 2 ] = 255;
}
export let defaultWhiteTexture = new THREE.DataTexture( dwtd, width, height, THREE.RGBFormat );



// default black texture
const dbtd = new Uint8Array( 3 * size );
for ( let i = 0; i < size; i ++ ) {
    dbtd[ i * 3 + 0 ] = 0;
    dbtd[ i * 3 + 1 ] = 0;
    dbtd[ i * 3 + 2 ] = 0;
}
export let defaultBlackTexture = new THREE.DataTexture( dbtd, width, height, THREE.RGBFormat );