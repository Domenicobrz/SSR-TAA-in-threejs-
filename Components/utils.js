import * as THREE from "three";

let Utils = { };

Utils.onResize = function(element, callback) {
    const resize_ob = new ResizeObserver((entries) => {
        // since we are observing only a single element, so we access the first element in entries array
        let rect = entries[0].contentRect;
    
        // current width & height
        let width = rect.width;
        let height = rect.height;
    
        callback(width, height);
    });

    // start observing for resize
    resize_ob.observe(element);
}

Utils.parseIncludes = function( string ) {
    var utils_includepattern = /#include <(.*)>/gm;
    
    function replace( match , include ) {
        var replace = THREE.ShaderChunk[ include ];
        return Utils.parseIncludes( replace );
    }

    return string.replace( utils_includepattern, replace );
}

export default Utils;