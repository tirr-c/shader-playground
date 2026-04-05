@group(0) @binding(1) var obj_texture: texture_2d<f32>;
@group(0) @binding(2) var obj_sampler: sampler;

@group(1) @binding(0) var<uniform> uniforms: Uniforms;

@group(2) @binding(0) var<uniform> point_light: PointLight;
@group(2) @binding(1) var shadow_texture: texture_depth_2d;
@group(2) @binding(2) var shadow_sampler: sampler_comparison;

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
  let light_dir_v = uniforms.view_mat * vec4(light.dir_and_half_theta.xyz, 0.0);
  let light_dir_v_norm = normalize(light_dir_v);
  let light_half_theta_upper_cos = cos(light.dir_and_half_theta.w);
  let light_half_theta_lower_cos = cos(light.dir_and_half_theta.w * 1.1);
  let position_v = frag_data.position_v;

  let n_norm = normalize(frag_data.n);
  let light_ray_v = position_v - light_pos_v;
  let light_ray_v_norm = normalize(light_ray_v);
  let spotlight_strength = smoothstep(
    light_half_theta_lower_cos,
    light_half_theta_upper_cos,
    dot(light_ray_v_norm, light_dir_v_norm),
  );
  let light_dist_sq = dot(light_ray_v, light_ray_v);
  let light_strength = spotlight_strength * max(dot(n_norm, -light_ray_v_norm), 0.0) / light_dist_sq;

  let scatter_ray_v = normalize(-position_v);
  let pdf = scattering_pdf(frag_data.material_kind, n_norm, light_ray_v_norm, scatter_ray_v);
  return light.color_intensity * (pdf * light_strength);
}

@fragment
fn main(frag_data: VertexOut) -> @location(0) vec4f {
  let scatter_intensity = compute_intensity(point_light, frag_data);

  var albedo: vec4f;
  if (frag_data.uv_or_color.w < 0.0) {
    albedo = textureSample(obj_texture, obj_sampler, frag_data.uv_or_color.xy);
  } else {
    albedo = frag_data.uv_or_color;
  }

  // Sample from shadow map with perspective correction
  let shadow_pos = frag_data.shadow_pos.xyz / frag_data.shadow_pos.w;
  let shadow_xy = shadow_pos.xy * vec2(0.5, -0.5) + vec2(0.5);
  let light_depth = shadow_pos.z;
  let visibility = textureSampleCompare(shadow_texture, shadow_sampler, shadow_xy, light_depth - 0.001);

  let intensity = vec4(scatter_intensity * visibility, 1.0);
  return albedo * intensity;
}
