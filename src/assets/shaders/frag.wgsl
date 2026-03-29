@group(0) @binding(1) var boxSampler: sampler;
@group(0) @binding(2) var boxTexture: texture_2d<f32>;

@group(1) @binding(0) var<uniform> uniforms: Uniforms;
@group(1) @binding(1) var<storage> point_lights: PointLights;

// All vectors should be normalized
fn scattering_pdf(material: u32, n: vec4f, incident_ray: vec4f, scatter_ray: vec4f) -> f32 {
  switch (material) {
    case MATERIAL_LAMBERTIAN: {
      // Lambertian diffuse material
      let diffuse_theta = max(dot(n, scatter_ray), 0.0);
      return diffuse_theta / 3.14159265;
    }
    default: {
      return 0.0;
    }
  }
}

fn compute_intensity(light: PointLight, frag_data: VertexOut) -> vec3f {
  let light_pos_v = uniforms.view_mat * vec4(light.pos, 1.0);
  let position_v = frag_data.position_v;

  let n_norm = normalize(frag_data.n);
  let light_ray_v = position_v - light_pos_v;
  let light_ray_v_norm = normalize(light_ray_v);
  let light_dist_sq = dot(light_ray_v, light_ray_v);
  let light_strength = max(dot(n_norm, -light_ray_v_norm), 0.0) / light_dist_sq;

  let scatter_ray_v = normalize(-position_v);
  let pdf = scattering_pdf(frag_data.material_kind, n_norm, light_ray_v_norm, scatter_ray_v);
  return light.color_intensity * (pdf * light_strength);
}

@fragment
fn main(frag_data: VertexOut) -> @location(0) vec4f {
  let num_point_lights = min(point_lights.valid_len, arrayLength(&point_lights.data));

  var scatter_intensity: vec3f = vec3(0.0, 0.0, 0.0);
  for (var i: u32 = 0; i < num_point_lights; i += 1) {
    scatter_intensity += compute_intensity(point_lights.data[i], frag_data);
  }

  let albedo = textureSample(boxTexture, boxSampler, frag_data.uv);
  let intensity = vec4(scatter_intensity, 1.0);
  return albedo * intensity;
}
